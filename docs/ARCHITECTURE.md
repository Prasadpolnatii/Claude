# Architecture

Grounded, async AI copilot for on-call engineers. Three features
(Ticket Summarization, SOP Search, RCA Generation) share one architecture:
**async job → SSE stream → grounded result → human edit → save**.

## System architecture

```mermaid
flowchart TB
  subgraph Client["Browser"]
    SPA["React SPA<br/>AIBlock trust UX · SSE"]
  end

  subgraph API["Express API (process 1)"]
    MW["JWT auth · rate limit · error envelope"]
    R["Routes: jobs · tickets · sops · rca"]
  end

  subgraph Worker["BullMQ Worker xN (process 2)"]
    ORC["Orchestrator<br/>redact → retrieve → fence → LLM → validate"]
  end

  subgraph Redis["Redis"]
    Q["BullMQ queue"]
    B["budget meter"]
    RL["rate-limit counters"]
    MS["mock SOP store (no-Mongo mode)"]
  end

  MONGO[("MongoDB / Atlas<br/>Vector Search<br/>tickets · summaries · sops · rca")]
  OPENAI["OpenAI<br/>chat + embeddings"]

  SPA -->|"HTTPS (Bearer JWT)"| MW --> R
  R -->|"enqueue → 202 {jobId}"| Q
  SPA <-->|"SSE (60s stream token)"| R
  Q --> ORC
  ORC -->|persist / retrieve| MONGO
  ORC -->|"redact, then call"| OPENAI
  ORC --> B
  R --> MONGO
  R --> RL
  ORC -.->|"no-Mongo fallback"| MS
```

**Why two processes?** Generative calls take 10–60 s. Running them in an Express
handler would exhaust the event loop and time out. The API stays responsive and
returns `202 + jobId`; the worker does the slow work and streams results back via
SSE. They communicate only through Redis (queue + events) and MongoDB.

**Graceful degradation.** The API boots without MongoDB: health + jobs work, SOP
search uses a Redis-backed store, and Mongo-only routes return a clean
`503 db_unavailable`. Mock LLM mode runs the full flow with no API key.

## Folder structure

```
ai-ops-copilot/
├── package.json                      # npm workspaces root (dev/worker/seed/test/typecheck)
├── docker-compose.yml                # Mongo + Redis for local dev
├── tsconfig*.json                    # composite TS project references
├── .github/workflows/ci.yml          # typecheck + tests (real Mongo+Redis) + web build
├── packages/
│   └── shared/                       # @ops-copilot/shared — API↔web contract
│       └── src/index.ts              # ApiError, Job, GroundedResult, Citation, *Summary, RcaDocument
└── apps/
    ├── api/                          # @ops-copilot/api
    │   ├── atlas/sop_vector_index.json   # Atlas Vector Search index definition
    │   ├── evals/injection.test.ts       # redaction/injection red-team suite
    │   └── src/
    │       ├── index.ts              # Express bootstrap, route mounting, limiter
    │       ├── config.ts             # zod-validated env, secret/placeholder guards
    │       ├── seed.ts               # demo tenant + dev JWT
    │       ├── auth/jwt.ts           # requireAuth, signStreamToken, requireStreamToken
    │       ├── db/
    │       │   ├── mongo.ts          # lazy connect, warm connect + index bootstrap
    │       │   └── indexes.ts        # ensureCollectionIndexes / ensureVectorSearchIndex
    │       ├── features/
    │       │   ├── redaction.ts      # fail-closed PII/secret scrubber
    │       │   ├── chunker.ts        # overlapping document chunker
    │       │   ├── docExtract.ts     # PDF/text extraction (unpdf)
    │       │   ├── sopStore.ts       # dual-mode SOP store (Atlas / Redis)
    │       │   ├── vectorMath.ts     # pure cosine + cosineRank
    │       │   ├── audit.ts          # redaction audit + Redis budget meter
    │       │   ├── redisStore.ts     # shared lazyConnect Redis client
    │       │   ├── summary.ts        # ticket-summary save schema
    │       │   └── rca.ts            # RCA generate/save schemas
    │       ├── llm/
    │       │   ├── client.ts         # OpenAI client + deterministic mock
    │       │   └── orchestrator.ts   # summarizeTicket / answerFromSops / generateRca
    │       ├── middleware/
    │       │   ├── error.ts          # uniform envelope + asyncHandler
    │       │   ├── requireMongo.ts   # lazy Mongo gate (503 when down)
    │       │   └── rateLimit.ts      # Redis fixed-window limiter
    │       ├── models/index.ts       # Mongoose schemas (tenant-scoped)
    │       ├── queue/
    │       │   ├── queue.ts          # BullMQ queue + events + connection
    │       │   └── worker.ts         # job processor + failure classification
    │       ├── routes/               # jobs.ts · tickets.ts · sops.ts · rca.ts
    │       ├── scripts/createIndexes.ts  # one-shot index creation
    │       └── integration/realdb.test.ts # real-DB integration tests
    └── web/                          # @ops-copilot/web (React + Vite)
        └── src/
            ├── App.tsx               # tabs: Incident Workspace · SOP Search · RCA
            ├── api/client.ts         # typed API client + SSE
            ├── hooks/useJob.ts       # useJobStream — submit + consume SSE
            ├── components/           # AIBlock · EditableSummary · EditableRca
            └── pages/                # IncidentWorkspace · SopSearch · RcaPage
```

## Authentication flow

```mermaid
sequenceDiagram
  participant C as Client (SPA)
  participant API as Express API
  participant J as JWT (HS256)

  Note over C,API: Normal API calls — header bearer
  C->>API: POST /api/jobs  (Authorization: Bearer <session JWT>)
  API->>J: verify(secret, {issuer, algorithms:[HS256]})
  J-->>API: { tenantId, sub, role }
  API-->>C: 202 { jobId }

  Note over C,API: SSE — EventSource can't send headers
  C->>API: GET /api/jobs/:id/stream-token  (Bearer <session JWT>)
  API->>API: loadOwnedJob (tenant check)
  API->>J: signStreamToken({tenantId, jobId, purpose:sse}, exp 60s)
  API-->>C: { streamToken, expiresIn: 60 }
  C->>API: EventSource /api/jobs/:id/stream?t=<streamToken>
  API->>J: verify + check purpose=sse AND jobId == :id
  J-->>API: ok → req.auth
  API-->>C: SSE: status → token* → done
```

The session JWT (12 h) is **never** put in a URL. The SSE route takes a separate
60 s, single-purpose token bound to one job id — a leaked stream URL expires in a
minute and unlocks only that job's stream.

## Feature flows

### Ticket Summarization

```mermaid
flowchart LR
  T["Select ticket"] --> S["POST /tickets/:id/summarize"]
  S --> Q["enqueue ticket_summary"]
  Q --> W["worker: redact → fence → gpt-4o-mini (JSON) → validate"]
  W --> R["GroundedResult<TicketSummary><br/>citation + confidence + redacted"]
  R --> SSE["SSE done"]
  SSE --> E["AIBlock → human edit"]
  E --> SV["PUT /tickets/:id/summary (upsert)"]
```

### SOP Search (RAG)

```mermaid
flowchart LR
  U["POST /sops/upload<br/>PDF/.md/.txt"] --> X["extract text (unpdf)"]
  X --> CH["chunk (overlap)"]
  CH --> EM["embed each chunk"]
  EM --> ST[("store: Atlas Vector Search<br/>or Redis mock")]
  QY["POST /sops/search {query}"] --> JOB["enqueue sop_search"]
  JOB --> RET["redact query → embed → $vectorSearch / cosine"]
  RET --> ANS["LLM answers ONLY from retrieved chunks (prose, streamed)"]
  ANS --> CIT["GroundedResult + SOP citations + confidence"]
```

### RCA Generation

```mermaid
flowchart LR
  IN["POST /rca/generate<br/>{incidentSummary, logSnippet}"] --> JOB["enqueue rca"]
  JOB --> RD["redact incident + log"]
  RD --> SOP["retrieve SOP chunks"]
  SOP --> FN["fence incident + log + SOPs as UNTRUSTED"]
  FN --> LLM["gpt-4o (JSON) → validate vs rcaSchema"]
  LLM --> RES["RcaDocument + log & SOP citations + confidence"]
  RES --> ED["AIBlock → human edit"]
  ED --> SV["POST /rca (upsert by incidentId)"]
```

Detailed **sequence diagrams** for all three are in
[QUEUE_AND_WORKER_FLOW.md](QUEUE_AND_WORKER_FLOW.md).

## Key design decisions

- **Async-first** — every generative endpoint returns `202 + jobId`; results
  stream over SSE. No LLM work in request handlers.
- **Grounding is the product** — every answer carries citations + a confidence
  score; the orchestrator validates LLM JSON against zod schemas, so a malformed
  response becomes a clean error instead of a broken object.
- **Fail-closed redaction** — PII/secrets are scrubbed before *every* OpenAI call
  (chat and embeddings); redaction failure aborts the call.
- **Defense in depth for injection** — untrusted content is fenced with a
  per-call random nonce and never reaches a command executor.
- **Multi-tenant from day one** — `tenantId` on every document, every query, and
  every Redis key; job ownership is checked before streaming.
- **Dual-mode storage** — Atlas Vector Search when Mongo is up; a Redis store
  shared across API + worker when it's down (mock mode), so the whole flow is
  demoable with no database.

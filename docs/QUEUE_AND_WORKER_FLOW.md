# Queue & Worker Flow

Generative work runs **off the request path**. The API enqueues a job and returns
`202 + jobId`; a separate worker process consumes the queue, runs the LLM
orchestration, and streams progress back over SSE.

- **Queue:** BullMQ on Redis, queue name `generative`.
- **Worker:** `apps/api/src/queue/worker.ts`, `concurrency: 4`, `attempts: 2`
  with exponential backoff.
- **Events bus:** a shared `QueueEvents` the SSE route subscribes to.

## Queue + worker

```mermaid
flowchart TB
  subgraph API
    SUB["route: validate → rate-limit → generativeQueue.add"]
    SSE["SSE route: requireStreamToken → subscribe events"]
  end
  subgraph Redis
    Q[("generative queue")]
    EV[("QueueEvents bus")]
    BUD[("budget:{tenant}:{day}")]
  end
  subgraph Worker["Worker xN (concurrency 4)"]
    GUARD["isOverBudget? → budget_exceeded"]
    PROC["process(): orchestrator"]
    FAIL["classify → JSON-encode ApiError"]
  end

  SUB -->|"202 {jobId}"| Q
  Q --> GUARD --> PROC
  PROC -->|"progress(token)"| EV
  PROC -->|"recordTokens"| BUD
  PROC -->|"return result"| Q
  PROC -. on throw .-> FAIL --> Q
  EV --> SSE
```

**Failure propagation.** BullMQ only persists a failure *message* string. The
worker classifies every failure into an `ApiError` (`redaction_failed`,
`db_unavailable`, `llm_unavailable`, `budget_exceeded`, `internal`) and
**JSON-encodes it** into the thrown error; the SSE layer (`decodeJobError`)
recovers the real `code` + `retryable`. So a non-retryable `redaction_failed`
never reaches the UI mislabelled as a retryable `internal`.

**Budget.** `isOverBudget` (Redis) is checked *before* a job spends; `recordTokens`
increments the per-tenant daily counter *after* the call. Shared across all
worker processes; fails open on a Redis error.

## SSE flow

```mermaid
sequenceDiagram
  participant C as Client
  participant API
  participant EV as QueueEvents
  participant W as Worker

  C->>API: GET /jobs/:id/stream-token (Bearer)
  API-->>C: { streamToken (60s) }
  C->>API: EventSource ?t=streamToken
  API->>API: verify token (purpose=sse, jobId match)
  alt job already finished (fast job race)
    API-->>C: data: done|error  (replayed immediately)
  else still running
    API-->>C: data: status running
    W-->>EV: progress(token)   %% prose answers only
    EV-->>API: progress
    API-->>C: data: token …
    W-->>EV: completed
    EV-->>API: completed
    API-->>C: data: done { job }
  end
  Note over API,C: listeners cleaned up on close/end
```

The **already-finished check** on stream open fixes the race where a fast (mock)
job completes before the browser subscribes — the terminal event is replayed
instead of the client hanging. JSON-mode features (ticket summary, RCA) stream
**no** token events (partial JSON is useless); the UI shows "Thinking…" and
renders the structured result on `done`. Prose answers (SOP search) stream tokens.

---

## Sequence diagrams

### Ticket Summarization

```mermaid
sequenceDiagram
  participant C as Client
  participant API
  participant Q as Queue
  participant W as Worker
  participant O as OpenAI
  participant M as MongoDB

  C->>API: POST /tickets/:id/summarize (Bearer, Idempotency-Key)
  API->>M: load ticket (tenant-scoped)
  API->>Q: add ticket_summary { ticketText }
  API-->>C: 202 { jobId }
  C->>API: stream-token → EventSource
  Q->>W: ticket_summary
  W->>W: redact(ticketText)  %% fail-closed
  W->>O: chat gpt-4o-mini (JSON, fenced)
  O-->>W: { headline, summary, impact, nextActions }
  W->>W: validate vs zod; build GroundedResult
  W-->>API: completed → SSE done
  API-->>C: GroundedResult (citation + confidence + redacted)
  C->>C: human edits in AIBlock
  C->>API: PUT /tickets/:id/summary (editedByHuman)
  API->>M: upsert (unique tenantId+ticketId)
  API-->>C: saved summary
```

### SOP Search (RAG)

```mermaid
sequenceDiagram
  participant C as Client
  participant API
  participant Q as Queue
  participant W as Worker
  participant ST as SOP store (Atlas/Redis)
  participant O as OpenAI

  Note over C,ST: Ingest
  C->>API: POST /sops/upload (file)
  API->>API: extractText → chunk
  API->>O: embed each chunk
  API->>ST: store chunks + vectors
  API-->>C: 201 { document, chunks }

  Note over C,O: Query
  C->>API: POST /sops/search { query }
  API->>Q: add sop_search
  API-->>C: 202 { jobId } → stream
  Q->>W: sop_search
  W->>W: redact(query)
  W->>O: embed(query)
  W->>ST: $vectorSearch (Atlas) / cosine (fallback), tenant-filtered
  ST-->>W: top-k SOP chunks
  alt no chunks
    W-->>API: "no source found" (honest, low confidence)
  else
    W->>O: chat — answer ONLY from fenced chunks (prose, streamed)
    O-->>W: grounded answer
  end
  W-->>API: GroundedResult + SOP citations + confidence
  API-->>C: SSE tokens → done
```

### RCA Generation

```mermaid
sequenceDiagram
  participant C as Client
  participant API
  participant Q as Queue
  participant W as Worker
  participant ST as SOP store
  participant O as OpenAI
  participant M as MongoDB

  C->>API: POST /rca/generate { incidentSummary, logSnippet }
  API->>Q: add rca
  API-->>C: 202 { jobId } → stream
  Q->>W: rca
  W->>W: redact(incident + log)  %% fail-closed
  W->>ST: retrieve SOP chunks (redacted query)
  W->>W: fence incident + log + SOPs (UNTRUSTED, nonce)
  W->>O: chat gpt-4o (JSON) → validate vs rcaSchema
  O-->>W: { title, rootCause, contributingFactors, timeline, remediation }
  W-->>API: GroundedResult + log & SOP citations + confidence
  API-->>C: SSE done
  C->>C: human edits in AIBlock
  C->>API: POST /rca (upsert by incidentId)
  API->>M: persist RCA
  API-->>C: saved RCA
```

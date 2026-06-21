# AI Operations Copilot — Architecture & Status

Grounded, async AI copilot for on-call engineers. Core-3: Ticket Summarization,
SOP Search, RCA Generation. Stack: React + Express + MongoDB (Atlas Vector
Search) + Redis/BullMQ + OpenAI.

## 1. Architecture diagram

```
┌──────────────┐   HTTPS    ┌───────────────────────────┐
│  React SPA   │ ─────────► │        Express API        │
│ (Vite)       │            │  - JWT auth (HS256)       │
│  AIBlock     │ ◄───SSE────│  - rate limit (Redis)     │
│  trust UX    │  tokens    │  - uniform error envelope │
└──────────────┘            └─────────────┬─────────────┘
        ▲                                  │ enqueue (202 + jobId)
        │ stream-token (60s, job-scoped)   ▼
        │                         ┌──────────────────┐
        │                         │  BullMQ / Redis  │  ◄── token-budget meter
        │                         │   generative Q   │      mock SOP store (no Mongo)
        │                         └────────┬─────────┘      rate-limit counters
        │                                  │ process
        │            progress/done         ▼
        └────────────────────────┌──────────────────┐
                                  │   Worker (×N)    │
                                  │  orchestrator:   │
                                  │  redact→retrieve │
                                  │  →fence→LLM      │
                                  └───┬──────────┬───┘
                                      │          │
                  ┌───────────────────▼──┐   ┌───▼──────────────────┐
                  │ MongoDB / Atlas      │   │ OpenAI               │
                  │  Vector Search       │   │  chat + embeddings   │
                  │  tickets, summaries, │   │  ↑ redaction proxy   │
                  │  sops(+embedding),   │   │   (fail-closed)      │
                  │  rca, audit          │   └──────────────────────┘
                  └──────────────────────┘
```

**Two processes share Redis + Mongo:** the API serves HTTP only; the worker runs
the LLM. The API stays up without Mongo (health + jobs work; SOP search uses a
Redis store; ticket/RCA persistence returns `503 db_unavailable`).

## 2. API list

Auth: `Authorization: Bearer <jwt>` unless noted. Generative endpoints are rate
limited to 30/60s per tenant; all `/api` to 300/60s per IP.

| Method | Path | Auth | Mongo | Purpose |
|--------|------|------|-------|---------|
| GET  | `/api/health` | none | no | liveness + `{ llmMode, mongo }` |
| POST | `/api/jobs` | bearer | no | enqueue a generative job → `202 {jobId}` |
| GET  | `/api/jobs/:id` | bearer | no | poll job status/result |
| GET  | `/api/jobs/:id/stream-token` | bearer | no | mint a 60s job-scoped SSE token |
| GET  | `/api/jobs/:id/stream?t=` | stream token | no | SSE: token / done / error |
| GET  | `/api/tickets` | bearer | **yes** | tenant ticket inbox |
| POST | `/api/tickets` | bearer | **yes** | ingest a ticket |
| POST | `/api/tickets/:id/summarize` | bearer | **yes** | enqueue ticket summary → `{jobId}` |
| GET  | `/api/tickets/:id/summary` | bearer | **yes** | fetch saved summary |
| PUT  | `/api/tickets/:id/summary` | bearer | **yes** | persist reviewed summary (upsert) |
| POST | `/api/sops/upload` | bearer | optional | PDF/.md/.txt → extract→chunk→embed→store |
| POST | `/api/sops` | bearer | optional | add a runbook section directly |
| POST | `/api/sops/search` | bearer | optional | grounded answer (async) → `{jobId}` |
| GET  | `/api/sops/search?q=` | bearer | optional | fast raw retrieval (no LLM) |
| POST | `/api/rca/generate` | bearer | optional | enqueue grounded RCA → `{jobId}` |
| POST | `/api/rca` | bearer | **yes** | persist reviewed RCA (upsert by incidentId) |
| GET  | `/api/rca/:id` | bearer | **yes** | fetch saved RCA |

"optional" = works in mock mode via the Redis store; uses Mongo/Atlas when up.

## 3. Database schema (MongoDB)

Every document is tenant-scoped (`tenantId`, indexed). Timestamps on all.

| Collection | Key fields | Indexes |
|------------|-----------|---------|
| `users` | tenantId, email, role | unique (tenantId, email) |
| `tickets` | tenantId, externalId, title, body, status | tenantId |
| `incidents` | tenantId, title, summary, logSnippet, ticketId | tenantId |
| `sops` | tenantId, title, section, **embedding[1536]**, embeddingVersion | tenantId; **Atlas Vector Search `sop_vector_index`** on `embedding` (cosine) + `tenantId` filter |
| `summaries` | tenantId, ticketId, headline, summary, impact, nextActions[], confidence, citations[], model, editedByHuman | **unique (tenantId, ticketId)** |
| `rca` | tenantId, incidentId, title, rootCause, contributingFactors[], timeline[], remediation[], confidence, citations[], editedByHuman | tenantId, (tenantId, incidentId) |
| `redactionaudits` | tenantId, jobId, hits, at | — |

Redis keys: `bull:*` (queue), `budget:{tenant}:{day}` (token meter), `rl:*`
(rate limit), `sops:mock:{tenant}` (no-Mongo SOP store).

## 4. Queue & worker flow

```
client ──POST /…/generate|summarize|search──► API
  API: validate → rate-limit → generativeQueue.add(type, {tenantId, input})
       → 202 { jobId }
  client ──GET /jobs/:id/stream-token──► API → 60s token
  client ──EventSource ?t=token──► API SSE handler
       subscribes to queueEvents(progress|completed|failed); if already
       finished, emits terminal event immediately (race-safe)

worker (BullMQ, concurrency 4):
  isOverBudget(tenant)?  ── yes ─► throw budget_exceeded (encoded ApiError)
        │ no
  orchestrator:
     guardedRedact(inputs)            (fail-closed; PII never reaches OpenAI)
     → searchSops (Atlas $vectorSearch │ cosine fallback │ Redis mock)
     → fence untrusted as <UNTRUSTED id=nonce> … (prompt-injection defense)
     → chat(json|prose)  ── prose streams tokens; json shows "Thinking…"
     → validate JSON vs zod schema
     → GroundedResult { data, citations, confidence, redacted }
     recordTokens(tenant)  (Redis meter)
  on failure: JSON-encode classified ApiError → BullMQ failedReason
              → SSE decodes real { code, retryable }
```

## 5. Security posture report

| Area | Status |
|------|--------|
| Dependencies | `npm audit`: **0 vulnerabilities** (removed unused `@langchain/openai` → killed langsmith SSRF/proto-pollution) |
| Secrets | none hardcoded; `.env` gitignored, never committed; JWT placeholder rejected in production |
| AuthN | JWT HS256 **pinned**; header-only for API; short-lived (60s) job-scoped SSE tokens |
| AuthZ / tenancy | every query tenant-scoped; job ownership checked; Redis keys tenant-namespaced |
| Injection | no `exec`/`eval`/`child_process`; no NoSQL injection (zod/ObjectId-validated, no req objects in filters) |
| Prompt injection | untrusted content fenced with per-call nonce; output never executed |
| PII egress | fail-closed redaction proxy before **every** OpenAI call (incl. search-query embed) |
| Rate limiting | Redis fixed-window: 300/60s per IP, 30/60s per tenant on generative |
| Errors | uniform envelope; no stack/PII leakage |

**Residual (P3, accepted):** session JWT in `localStorage` (XSS tradeoff, mitigated
by short-lived stream tokens); multer `LIMIT_FILE_SIZE` → generic 500; untrusted
PDF parsing bounded by 10 MB; redaction is regex best-effort.

## 6. Open issues & deferred items

**Open / known:**
- Atlas `$vectorSearch` is verified by index definition, not executed end-to-end
  (no Atlas reachable from the build sandbox; CI uses plain `mongo:7` → cosine
  fallback path). Needs a one-time run against a real Atlas cluster.
- SOPs uploaded in no-Mongo mock mode (Redis) are not migrated when Mongo later
  comes up (mode split). Fine for an always-on Atlas deployment.
- Cosine fallback is O(n) over `Sop.find()` — only for non-Atlas/dev.
- Token budget is check-before + record-after (eventually consistent), not a hard
  pre-reservation.

**Deferred (v2, per /autoplan):** log-stream analysis, command recommendations
(advisory-only), email drafting (folds into the summarizer); SSO; multi-region.

## 7. Production-readiness checklist

- [x] Async job queue + SSE (no LLM in request handlers)
- [x] Fail-closed PII redaction before every model call
- [x] Prompt-injection fencing (per-call nonce)
- [x] Multi-tenant isolation (data + Redis keys + job ownership)
- [x] JWT auth (HS256 pinned) + short-lived SSE tokens
- [x] Rate limiting (Redis, per-IP + per-tenant)
- [x] Uniform error envelope with correct `retryable`
- [x] Redis-backed token budget meter (shared across processes)
- [x] CI: typecheck + unit + integration (real Mongo + Redis) + web build
- [x] `npm audit`: 0 vulnerabilities
- [x] Graceful degradation without Mongo
- [x] Index bootstrap + Atlas Vector Search index definition
- [ ] **Run once against a real Atlas cluster** (provision + `db:indexes` + smoke)
- [ ] Secrets manager for `JWT_SECRET` / `OPENAI_API_KEY` (not `.env`)
- [ ] Observability: structured logs, metrics, tracing, alerting
- [ ] Backups / PITR on Atlas; Redis persistence/HA
- [ ] Autoscaling for the worker; dead-letter handling for poisoned jobs
- [ ] Load/cost testing with real embeddings; per-tenant budgets tuned
- [ ] CORS/CSP hardening; security headers (helmet); request size limits per route
```

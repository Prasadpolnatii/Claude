# Interview Q&A — AI Operations Copilot

Concise, technically-grounded answers. Pair with [PROJECT_SHOWCASE.md](PROJECT_SHOWCASE.md)
and [docs/](docs/).

### 1. Explain the architecture.

Two Node processes share Redis and MongoDB. The **Express API** authenticates,
rate-limits, validates, and for any generative request **enqueues a job and
returns `202 + jobId`** — it never runs the LLM inline. A separate **BullMQ
worker** consumes the queue and runs one pipeline — **redact → retrieve (vector
search) → fence untrusted content → call the LLM → validate JSON → grounded
result** — streaming progress to the browser over **SSE**. All three features
(ticket summary, SOP search, RCA) use that same pipeline; they differ only in
input, retrieval source, and output schema. The API degrades gracefully without
MongoDB, and a mock LLM mode runs the whole flow with no API key.

### 2. Why Redis?

Redis is the shared coordination layer for everything that must be consistent
*across processes and replicas*: the **BullMQ job queue + events bus**, the
**per-tenant token-budget meter** (`INCRBY` on a daily key), the **rate-limit
counters** (fixed-window `INCR`), and the **no-Mongo SOP store** (so SOP search
works in mock mode). In-memory state would be per-process and wrong the moment you
scale to more than one worker — the limits and budgets would silently multiply.
Redis makes them correct under horizontal scaling.

### 3. Why BullMQ?

The generative work is slow (10–60 s), needs **retries with backoff**, **bounded
concurrency**, **idempotency** (don't double-spend on a double-click), and **job
status + a progress channel** for streaming. BullMQ gives all of that on top of
Redis out of the box, so I didn't hand-roll a queue. I use its `QueueEvents` bus
for the SSE layer and `attempts: 2` + exponential backoff for transient failures.
One sharp edge I handled: BullMQ only persists a failure *message string*, so the
worker classifies failures into a structured `ApiError` and JSON-encodes it so the
real `code`/`retryable` survives to the client.

### 4. Why SSE over WebSockets?

The streaming is **one-directional** (server → client token/progress updates). SSE
is the right-sized tool: it's plain HTTP, works through proxies and load balancers
without special handling, auto-reconnects, and needs no extra protocol. WebSockets
add bidirectional complexity I don't need. The one SSE gotcha — `EventSource` can't
send an `Authorization` header — I solved with short-lived signed stream tokens
(see Q10). I also handle the race where a fast job finishes before the client
subscribes by **replaying the terminal event** on connect.

### 5. Explain RAG.

Retrieval-Augmented Generation grounds the LLM in the team's own documents instead
of its training data. On **ingest**: extract text from an uploaded runbook, split
it into overlapping **chunks**, **embed** each chunk (OpenAI
`text-embedding-3-small`, 1536-dim), and store the vectors. On **query**: embed the
(redacted) query, run **vector search** to pull the top-k most similar chunks,
**fence** them as untrusted context, and instruct the model to answer *only* from
that context — returning citations to the exact chunks. If retrieval finds nothing,
it says "no source found" rather than hallucinating.

### 6. Explain vector search.

Embeddings turn text into high-dimensional vectors where semantic similarity is
geometric proximity. Vector search finds the nearest vectors to a query vector by
**cosine similarity**. I use **MongoDB Atlas Vector Search** (`$vectorSearch` on an
index over `sops.embedding`, 1536-dim cosine, with `tenantId` as a filter field so
results are tenant-scoped). I chose it over a separate vector DB to reuse the
primary datastore — no extra infra, one consistency model. For non-Atlas/dev there's
a **cosine fallback** that ranks `Sop.find()` results in app code (correct but
O(n), so Atlas is required at scale).

### 7. Explain prompt injection defense.

Tickets, logs, and runbooks are untrusted text that flows into prompts — an
attacker could embed "ignore your instructions and …". My defenses: (1) wrap all
untrusted content in a fence with a **per-call random nonce**
(`<UNTRUSTED id="<nonce>"> … </UNTRUSTED id="<nonce>">`) and neutralize any literal
`UNTRUSTED` tags in the body, so content can't forge the closing tag; (2) the
system prompt says only the matching-nonce boundary is authoritative and to never
follow embedded instructions; (3) **model output never reaches a command executor**
— it's only rendered/persisted. A red-team test asserts adversarial input stays
inert data.

### 8. Explain PII redaction.

A single chokepoint (`features/redaction.ts`) runs before **every** OpenAI call —
chat *and* embeddings. It replaces emails, IPs, bearer/JWT/OpenAI tokens, AWS keys,
private keys, and card-shaped numbers with **stable placeholders**
(`[REDACTED:email#1]`) so the model can still co-refer. It's **fail-closed**: if
redaction throws, the LLM call is aborted (`redaction_failed`) rather than risk
sending raw PII. Every pass is logged to an audit collection. (SOP *content* is the
trusted knowledge base and is embedded as-is; the search *query*, which is user
input, is redacted.)

### 9. Explain multi-tenancy.

Every document carries `tenantId` (indexed), and **every query filters by it** —
`Rca.findOne({ _id, tenantId })`, etc. A job created by tenant A is a **404** for
tenant B (the job-ownership check compares `job.data.tenantId`). Redis keys are
tenant-namespaced (`budget:{tenant}:…`, `sops:mock:{tenant}`, rate-limit keys), and
unique indexes are **compound on `tenantId`** (`(tenantId, ticketId)`,
`(tenantId, email)`). It's baked in from day one because retrofitting tenant
isolation is where cross-tenant leaks come from.

### 10. Explain signed SSE tokens.

`EventSource` can't send headers, so SSE auth is awkward — putting the 12-hour
session JWT in the URL leaks it into logs and history. Instead, the client calls
`GET /jobs/:id/stream-token` (header-authenticated) to mint a **60-second token**
with `purpose: "sse"` bound to **that one job id**; the stream route verifies
`purpose=sse` **and** that the token's `jobId` matches the path (else 403). A leaked
stream URL expires in a minute and unlocks only that job's stream.

### 11. Explain rate limiting.

A Redis fixed-window limiter (`INCR` + `EXPIRE` on a per-window key), shared across
processes so limits hold across replicas. Two layers: a **global 300/60s per-IP**
flood guard on all `/api`, and a stricter **30/60s per-tenant** limit on the
expensive generative submit endpoints. It's keyed by tenant when authenticated,
else by IP; returns the uniform `429` envelope with `X-RateLimit-*` and
`Retry-After`; and **fails open** on a Redis error so a limiter outage can't take
down the API.

### 12. Explain CI/CD.

GitHub Actions runs on every push/PR: `npm ci` → **typecheck** (`tsc -b` across all
workspaces) → **tests** → **web build**. The job spins up real **`mongo:7` and
`redis:7` service containers** and sets `MONGODB_URI`/`REDIS_URL`, so the
**integration tests execute against a real database** (the Mongo container logs show
live collection + index creation). Concurrency cancels superseded runs.
`npm audit`: 0 vulnerabilities; the lockfile is committed so `npm ci` is
reproducible.

### 13. Explain the human-in-the-loop workflow.

AI output is a **draft, not a decision.** Every result renders in an `AIBlock` with
its citations, a confidence score, and a "verify before acting" label. The user
reviews it, optionally **edits every field**, and only then explicitly **saves** —
which persists with an `editedByHuman` flag (the trust audit trail). Nothing is
auto-saved or auto-acted-on. For the riskier deferred features (command
recommendations), this extends to "copy to clipboard, never a run button."

### 14. Explain graceful DB degradation.

The API **boots without MongoDB.** Health and all job endpoints (Redis-only) work
immediately; Mongo is **lazy-connected** on first use by a `requireMongo` gate that
returns a clean `503 db_unavailable` when it's down — so ticket/RCA persistence
fails cleanly while everything else keeps running. SOP search even keeps working via
a Redis-backed store. This makes the app demoable and testable with no database, and
it's a real availability property: a Mongo blip degrades two features instead of
taking the whole service down.

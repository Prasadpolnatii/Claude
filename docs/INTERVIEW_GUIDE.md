# Interview Guide

A talking-points companion for presenting this project. Pair with
[ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY.md](SECURITY.md).

## Executive summary

**AI Operations Copilot** is a production-grade, multi-tenant web application that
helps on-call engineers resolve incidents faster. It does three things —
summarize tickets, answer questions from runbooks (RAG), and generate root-cause
analyses — and every AI output is **grounded** (cites its sources), **confidence-
scored**, and **human-edited before it's saved**.

The engineering story isn't "I called an LLM." It's everything around the LLM
that makes it safe and operable: an **async job queue with SSE streaming** so slow
model calls never block requests, a **fail-closed redaction proxy** so PII never
reaches the provider, **prompt-injection fencing**, **multi-tenant isolation**,
**Redis-backed rate limiting + token budgets**, **signed short-lived stream
tokens**, **MongoDB Atlas Vector Search** for retrieval, and **CI that runs
integration tests against a real database**. `npm audit`: 0 vulnerabilities.

Stack: React + Express + BullMQ/Redis + MongoDB Atlas + OpenAI, TypeScript ESM,
npm-workspaces monorepo.

## Architecture explanation (the 2-minute version)

Two processes share Redis and MongoDB:

1. **API (Express).** Authenticates (JWT), rate-limits, validates, and for any
   generative request **enqueues a job and returns `202 + jobId`** — it never runs
   the LLM inline.
2. **Worker (BullMQ).** Consumes the queue and runs the orchestration pipeline:
   **redact → retrieve grounding (vector search) → fence untrusted content → call
   the LLM → validate the JSON against a schema → return a grounded result.**

The browser streams progress over **SSE** using a 60-second, job-scoped token.
Results carry citations + a confidence score and render in an `AIBlock` component
that enforces "verify before acting" and a human edit-before-save step.

It **degrades gracefully**: the API boots without MongoDB (health + jobs still
work; SOP search uses a Redis store), and a mock LLM mode runs the entire flow
with no API key — which is also how the whole thing is demoable and testable
offline.

## Key tradeoffs

| Decision | Chosen | Alternative | Why |
|----------|--------|-------------|-----|
| Generative calls | **Async job + SSE** | Synchronous request | 10–60 s calls would exhaust the event loop and time out; async keeps the API responsive and lets workers scale independently. |
| Vector store | **MongoDB Atlas Vector Search** | Pinecone / pgvector / Chroma | Reuse the primary datastore — no extra infra, one consistency model. Cosine fallback covers non-Atlas/dev. |
| Streaming UX | **Tokens for prose, "Thinking…" for JSON** | Stream raw JSON tokens | Partial JSON is unreadable; structured features render on completion. |
| Error model | **Uniform envelope, `retryable` flag, encoded through the queue** | Ad-hoc strings | The UI can auto-handle transient vs terminal failures without string-matching; the worker's real error class survives BullMQ. |
| Redaction | **Fail-closed before every call** | Best-effort / post-hoc | A redaction bug must never leak PII; aborting the call is the safe default. |
| Tenancy | **`tenantId` everywhere from day one** | Add later | Retrofitting tenant isolation is error-prone; bake it into schemas, queries, and keys. |
| Budget/limits | **Redis-shared** | In-memory per process | Limits must hold across replicas; in-memory meters are per-process and wrong under scale. |

## Scalability decisions

- **Stateless API + horizontally-scaled workers.** Throughput scales by adding
  worker replicas (concurrency 4 each). Because the queue, budget meter, and rate
  limiter are all in Redis, limits and metering stay correct across replicas.
- **Retrieval offloaded to Atlas Vector Search** rather than loading vectors into
  app memory (the cosine fallback is explicitly O(n) and dev-only).
- **Backpressure & cost control** via the queue (bounded concurrency, retries with
  backoff) and the per-tenant token budget.
- **Idempotency keys** prevent double-spend on double-submits.
- **SSE over WebSockets** — one-directional server→client streaming is simpler to
  scale and proxy; the race where a fast job finishes before the client subscribes
  is handled by replaying the terminal event.

## Security decisions

- **Defense in depth for the LLM:** fail-closed redaction (PII egress) + nonce
  fencing (prompt injection) + no execution path from model output.
- **Auth:** HS256 **pinned** (no algorithm confusion), header-only; **signed 60 s
  job-scoped SSE tokens** so the session JWT never lands in a URL; production guard
  against the shipped placeholder secret.
- **Multi-tenant isolation** enforced in every query, Redis key, and job-ownership
  check; compound unique indexes on `tenantId`.
- **Abuse controls:** Redis rate limiting (per-IP + per-tenant) and token budgets.
- **Supply chain:** removed an unused dependency that pulled a HIGH-severity SSRF
  chain → `npm audit` 0; lockfile-pinned `npm ci` in CI.
- **NoSQL injection** closed by zod validation + ObjectId checks (no request
  objects in filters).

## STAR interview answers

**1. Async pipeline (system design)**
- **S:** LLM calls take 10–60 s; the UI needed live progress.
- **T:** Serve generative features without blocking requests or timing out.
- **A:** Built an async pipeline — API enqueues to BullMQ/Redis and returns
  `202 + jobId`; a separate worker runs the orchestration and streams tokens over
  SSE. Added an already-finished replay to fix the fast-job/subscribe race.
- **R:** Responsive API, independently scalable workers, live streaming UX;
  verified end-to-end in mock mode and against real services in CI.

**2. Fail-closed redaction (security)**
- **S:** Tickets and logs contain PII/secrets that would otherwise be sent to
  OpenAI.
- **T:** Guarantee PII never reaches the provider.
- **A:** A single redaction chokepoint runs before *every* OpenAI call (chat and
  embeddings), replacing secrets with stable placeholders and **aborting** the
  call on any redaction error; every pass is audit-logged. A red-team test suite
  asserts adversarial inputs stay inert.
- **R:** No PII egress path; the search-query embed gap was caught in review and
  closed. Verified: PII never appears in results across the pipeline.

**3. Error propagation through the queue (debugging/correctness)**
- **S:** Failed jobs reached the UI as a generic retryable `internal` error,
  losing the real cause.
- **T:** Surface the true failure class + `retryable` to the client.
- **A:** Found that BullMQ only persists a message string. The worker now
  classifies failures into an `ApiError` and JSON-encodes it into the failure; the
  SSE layer decodes the real `code`/`retryable`.
- **R:** A non-retryable `redaction_failed` is no longer mislabeled as retryable;
  verified by forcing a `budget_exceeded` job and asserting the decoded envelope.

**4. Dependency vulnerability (ownership)**
- **S:** `npm audit` reported a HIGH SSRF + prototype-pollution chain.
- **T:** Eliminate it without breaking the build.
- **A:** Traced it to `langsmith`, pulled transitively by `@langchain/openai` —
  which was **declared but never imported** (the orchestrator uses the OpenAI SDK
  directly). Removed the dependency.
- **R:** `npm audit`: 3 → **0** vulnerabilities; smaller install; no code change
  needed.

**5. Real-DB verification under constraints (pragmatism)**
- **S:** The build sandbox couldn't reach MongoDB Atlas (egress-blocked).
- **T:** Still verify the database-backed flows against a real database.
- **A:** Made the app Atlas-ready (configurable connection/timeout, index
  bootstrap, vector-index definition) and added integration tests gated on
  `MONGODB_URI`, then wired a real `mongo:7` service into CI so the tests run
  against an actual database on every push.
- **R:** CI confirmed real collection + unique-index creation and verified
  ticket/RCA persistence and SOP retrieval; Atlas-specific `$vectorSearch` is
  documented as a one-time config step.

**6. Multi-tenant from day one (judgment)**
- **S:** A shared-tenant copilot must never leak one customer's data to another.
- **T:** Make cross-tenant access impossible, not just unlikely.
- **A:** Put `tenantId` on every document, every query filter, every Redis key,
  and the job-ownership check; compound unique indexes include `tenantId`.
- **R:** No code path can read another tenant's data; a cross-tenant job id is a
  404. Baked in early, so no risky retrofit.

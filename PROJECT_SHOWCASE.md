# Project Showcase — AI Operations Copilot

A deep-dive into the engineering behind a production-grade, multi-tenant AI
application. For the API/schema/security details see [`docs/`](docs/).

## Problem statement

On-call engineers spend a large share of an incident not *fixing* it but
**triaging** it — reading the ticket, searching runbooks, correlating logs, and
then writing it all up afterward. Generic LLM chatbots don't help much here:
they hallucinate, they don't know *your* runbooks, and you can't trust an
ungrounded answer enough to act on it during an outage.

The goal: an assistant that is **fast, grounded, and trustworthy** — it cites the
team's own SOPs and logs, shows how confident it is, and keeps a human in the loop
for anything that gets saved or acted on. And it has to be **safe to run in a
shared, multi-tenant environment** with real PII flowing through it.

## Architecture decisions

**Two processes, one queue.** Generative calls take 10–60 seconds. Running them in
an Express handler would block the event loop and time out. So the **API enqueues
a job and returns `202 + jobId`**, and a separate **worker** does the slow work and
streams results back over SSE. They share only Redis (queue + events) and MongoDB.

**One orchestration pipeline, three features.** Ticket Summarization, SOP Search,
and RCA all run the same pipeline — **redact → retrieve → fence → LLM → validate
→ grounded result** — differing only in inputs, retrieval, and output schema. New
features are a new job type, not new infrastructure.

**Grounding is the product.** Every result carries citations + a confidence score,
and the orchestrator validates the model's JSON against a zod schema, so a
malformed response becomes a clean error instead of a broken object reaching the UI.

**Degrade gracefully.** The API boots without MongoDB (health + jobs work; SOP
search falls back to a Redis store); a mock LLM mode runs the whole flow with no
key. This isn't just nice-to-have — it's how the system stays testable and
demoable offline, and it's verified in CI.

## RAG pipeline

```
upload (PDF/.md/.txt)
  → extractText (unpdf for PDF, utf8 for text)
  → chunkText (overlapping windows; oversized paragraphs hard-split)
  → embed each chunk (OpenAI text-embedding-3-small, 1536-dim)
  → store: MongoDB Atlas Vector Search  (or Redis store in mock mode)

query
  → redact(query)                        # PII never reaches the embeddings API
  → embed(query)
  → $vectorSearch (Atlas, tenant-filtered)  OR  cosine over Sop.find() (fallback)
  → top-k SOP chunks
  → fence chunks as <UNTRUSTED id=nonce> … (injection defense)
  → LLM answers ONLY from the fenced context (prose, streamed)
  → GroundedResult { answer, citations[], confidence }
```

Key choices: **MongoDB Atlas Vector Search** instead of a separate vector DB
(reuse the primary datastore, one consistency model); a **cosine fallback** so it
works on non-Atlas/dev; **tenant-scoped vector filtering**; and an **honest
"no source found"** path that refuses to hallucinate when retrieval is empty.

## Queue and worker flow

- **Queue:** BullMQ on Redis (`generative`); jobs carry `{ tenantId, type, input }`.
- **Worker:** `concurrency: 4`, `attempts: 2` with exponential backoff.
- **Streaming:** the SSE route subscribes to a shared `QueueEvents` bus; if a fast
  job already finished, it **replays the terminal event** instead of hanging.
- **Failure propagation:** BullMQ only persists a message string, so the worker
  **classifies each failure into an `ApiError` and JSON-encodes it**; the SSE layer
  decodes the real `code` + `retryable`. A non-retryable `redaction_failed` is
  never mislabeled as a retryable `internal`.
- **Budget:** per-tenant token spend is checked (Redis) before a job runs and
  recorded after — shared across all worker replicas, fails open.

## Security decisions

Defense in depth, especially around the LLM:

- **Fail-closed PII redaction** before *every* OpenAI call (chat + embeddings) —
  emails, IPs, tokens, keys → stable placeholders; a redaction error **aborts** the
  call. Audit-logged.
- **Prompt-injection fencing** with a per-call random nonce; the model is told only
  the matching-nonce boundary is real; output never reaches an executor.
- **Multi-tenant isolation** in every query, Redis key, and job-ownership check;
  compound unique indexes include `tenantId`.
- **JWT HS256 pinned** + **signed 60s job-scoped SSE tokens** (the session JWT
  never lands in a URL); production guard against the placeholder secret.
- **Rate limiting** (Redis, per-IP + per-tenant) and **token budgets**.
- **NoSQL-injection** closed by zod + ObjectId validation.
- **Supply chain:** removed an unused dep pulling a HIGH SSRF chain → `npm audit` 0.

## CI/CD pipeline

GitHub Actions on every push/PR:

```
npm ci → npm run typecheck (tsc -b) → npm test → web build
services: mongo:7 + redis:7   env: MONGODB_URI, REDIS_URL, LLM_MODE=mock
```

The test step runs **integration tests against a real MongoDB service** — verified
by the Mongo container logs showing live collection + unique-index creation.
Concurrency cancels superseded runs.

## Testing strategy

A layered approach that stays fast and hermetic by default:

- **Unit (hermetic):** redaction + injection red-team, document chunker, vector
  math, all save schemas. No I/O.
- **Pipeline (Redis-gated):** the summarization + RCA grounding pipelines through
  the mock LLM — assert schema-valid output, redaction held end to end, and log +
  SOP citations. Skip cleanly without Redis.
- **Integration (DB-gated):** ticket/RCA persistence (incl. unique-upsert dedup)
  and SOP store→retrieval against a real database; run in CI, skip without a DB.
- **Live HTTP checks** during development verified the SSE token flow, rate-limit
  429s, and the error-envelope propagation.

`--test-force-exit` keeps a live Redis handle from hanging the runner.

## Scalability considerations

- **Stateless API + horizontally-scaled workers** — add worker replicas for LLM
  throughput; because the queue, budget meter, and rate limiter are Redis-shared,
  limits and metering stay correct across replicas.
- **Retrieval offloaded to Atlas Vector Search** rather than app memory.
- **Backpressure & cost control** via bounded concurrency, retries with backoff,
  idempotency keys, and per-tenant budgets.
- **SSE** is simpler to scale/proxy than WebSockets for one-directional streaming.

## Tradeoffs

| Decision | Chosen | Gave up | Why |
|----------|--------|---------|-----|
| Generative calls | Async + SSE | Simpler sync handlers | Long calls would block/timeout |
| Vector store | Atlas Vector Search | Best-in-class vector DB | No extra infra; one datastore |
| Streaming | Tokens for prose only | Streaming JSON | Partial JSON is unreadable |
| Persistence | Human save (draft in job 1h) | Auto-persist | Trust + edit-before-save |
| Budget | Check-before + record-after | Hard pre-reservation | Token cost unknown until after |
| Redaction | Regex, fail-closed | Perfect coverage | Pragmatic; pair with DLP for compliance |

## Lessons learned

- **The LLM is the easy 10%.** The redaction proxy, injection fencing, async
  pipeline, error propagation, tenancy, and limits were the real work — and what
  makes it shippable.
- **Run it for real, early.** Every meaningful bug surfaced from actually booting
  the system: the JSON-mode streaming bug, the BullMQ `:`-in-job-id crash, the
  Express-4 async-error crash, and the error-code-loss-through-the-queue all came
  from live runs, not static review.
- **Constraints force honest engineering.** Atlas was unreachable from the build
  sandbox, so instead of faking it I made the app Atlas-ready and verified the
  DB-backed flows against a real `mongo:7` service in CI — real verification, just
  executed where a database was reachable.
- **Decouple shared infra cleanly.** A test runner hang traced back to importing
  the eager BullMQ connection; giving the mock store and budget meter their own
  lazy Redis client kept unit tests hermetic.
- **Review pays for itself.** The internal `/review` + `/cso` passes caught a
  redaction bypass on the search-query embed and a HIGH-severity unused dependency
  — both fixed before "done."

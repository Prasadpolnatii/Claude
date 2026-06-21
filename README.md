# AI Operations Copilot

Grounded, async AI copilot for on-call engineers. Generated from a `/autoplan` review
and scaffolded to make every architectural decision concrete.

**v1 scope (the grounded core-3):**
- **Ticket summarization** — fast summaries with `gpt-4o-mini`.
- **SOP search** — RAG over your runbooks (MongoDB Atlas Vector Search); answers cite §source.
- **RCA generation** — root cause analysis grounded in retrieved SOPs + attached log snippets, with `gpt-4o`.

Deferred to v2: log-stream analysis, command recommendations. Email drafting folds into the summarizer.

---

## Why it's shaped this way (decisions baked into the code)

| Decision | Where it lives |
|----------|----------------|
| **Async job queue** — generative calls take 10–60s, never run in a request handler | `apps/api/src/queue/*`, routes return `202 + jobId` |
| **Fail-closed redaction proxy** — PII/secrets scrubbed before *every* OpenAI call | `apps/api/src/llm/redaction.ts` |
| **Prompt-injection defense** — untrusted content fenced as `<UNTRUSTED>` data, never instructions; output never executes | `apps/api/src/llm/orchestrator.ts` |
| **Grounding + confidence** — every answer carries citations + a confidence score; low-confidence is flagged | `orchestrator.ts`, `AIBlock.tsx` |
| **Trust UX** — "verify before acting", citations, confidence, human edit on every AI block | `apps/web/src/components/AIBlock.tsx` |
| **Multi-tenant from day 1** — `tenantId` on every doc + JWT scoping | `apps/api/src/models`, `auth/jwt.ts` |
| **Vector store = MongoDB** (no extra infra) | `apps/api/src/features/sopStore.ts` |
| **Streaming** — SSE token stream, ARIA live region | `routes/jobs.ts`, `hooks/useJob.ts` |
| **Mock-LLM mode** — full flow, no API key, no spend | `apps/api/src/llm/client.ts` |
| **Idempotency** — `Idempotency-Key` so a double-click doesn't double-bill | `routes/jobs.ts` |

## Architecture

```
React SPA ──HTTPS──► Express API ──► BullMQ/Redis queue ──► Worker
   │  SSE stream ◄────┘                                      │
   ▼                                              LangChain orchestration
MongoDB ◄── app data + Vector Search (SOP embeddings) ◄──────┤
                                                             ▼
                                         OpenAI (chat + embeddings)
                                         ↑ redaction proxy (fail-closed)
```

The **API process serves HTTP only**; generative work runs in a **separate worker**.
Both share Redis + Mongo. Run both.

### Degrades gracefully without MongoDB

The API boots even when Mongo is down. Health + job endpoints (Redis-only) work
immediately; Mongo is **lazy-connected** on first use by the ticket/SOP routes,
which return a clean `503 db_unavailable` if it's unreachable. This keeps
mock-mode demos fully working with just Redis — no database required.

| Endpoint | Needs Mongo? |
|----------|--------------|
| `GET /api/health` · `POST /api/jobs` · SSE stream · `ticket_summary` jobs | No |
| `GET/POST /api/tickets` · `/api/sops` · `sop_search` + `rca` jobs | Yes (503 if down) |

## Quick start (≈ 15 min, no OpenAI key needed)

```bash
# 1. infra
docker compose up -d            # Mongo + Redis

# 2. deps + env
npm install
cp .env.example .env            # LLM_MODE=mock by default → no key, no spend

# 3. seed a demo tenant (prints a dev JWT)
npm run seed

# 4. run API + web (terminal 1) and the worker (terminal 2)
npm run dev
npm run worker

# 5. open http://localhost:5173, paste the JWT from step 3
```

Flip to live OpenAI: set `LLM_MODE=openai` + `OPENAI_API_KEY` in `.env`.

> **Local vector search:** plain Mongo (via docker-compose) has no `$vectorSearch`,
> so `sopStore.ts` falls back to in-memory cosine similarity automatically. For
> production, use MongoDB Atlas and create a Vector Search index named
> `sop_vector_index` on `sops.embedding`.

## Tests

```bash
npm test     # redaction + prompt-injection red-team suite (apps/api/evals)
```

## Layout

```
packages/shared      # API/web contract: error envelope, job + grounding types
apps/api             # Express API + BullMQ worker + LangChain orchestration
  src/llm            #   redaction proxy, LLM client (+mock), orchestrator
  src/queue          #   queue + worker
  src/routes         #   jobs (submit/status/SSE), tickets, sops
  evals              #   injection.test.ts
apps/web             # React SPA — AIBlock trust UX, SSE streaming, workspace
```

## Status

This is a **scaffold**: structure + the load-bearing decisions are real and wired;
business logic is intentionally thin where noted. Not production-ready — see the
`/autoplan` failure-modes registry for what hardening remains (budget meter →
Redis, signed SSE URLs, eval coverage for grounding accuracy).

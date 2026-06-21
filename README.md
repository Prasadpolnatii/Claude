# AI Operations Copilot

A grounded, async AI copilot for on-call engineers. It turns incident tickets,
logs, and runbooks into **cited, confidence-scored** summaries, runbook answers,
and root-cause analyses — with a human-in-the-loop edit-before-save workflow.

> Production-grade reference implementation: async job queue, SSE streaming,
> fail-closed PII redaction, prompt-injection defense, multi-tenant isolation,
> Redis-backed rate limiting + budget metering, signed SSE tokens, MongoDB Atlas
> Vector Search RAG, CI with real-DB integration tests, and `npm audit`: 0 vulns.

## Core-3 features

| Feature | What it does |
|---------|-------------|
| **Ticket Summarization** | Summarizes a support/incident ticket (headline, impact, next actions), cited to the source. |
| **SOP Search (RAG)** | Upload runbooks (PDF/.md/.txt) → chunk → embed → MongoDB Atlas Vector Search → grounded answer with citations. |
| **RCA Generation** | Incident summary + log snippet → retrieves SOPs → produces a cited root-cause document. |

Every AI output streams over SSE, shows **citations + a confidence score**, is
labelled "verify before acting," and can be **edited by a human before it's saved**.

## Stack

React (Vite) · Express · BullMQ + Redis · MongoDB / Atlas Vector Search · OpenAI ·
TypeScript (ESM) · npm workspaces monorepo.

## Quick start (≈ 15 min, no OpenAI key needed)

```bash
docker compose up -d            # Mongo + Redis
npm install
cp .env.example .env            # LLM_MODE=mock by default → no key, no spend
npm run seed                    # seeds a demo tenant, prints a dev JWT
npm run dev                     # API (4000) + web (5173)
npm run worker                  # second terminal
# open http://localhost:5173, paste the JWT
```

Flip to live OpenAI: set `LLM_MODE=openai` + `OPENAI_API_KEY` in `.env`.
Mock mode runs the **entire** flow (including SOP RAG via a Redis store) with no
database and no API key.

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, folder structure, feature + auth diagrams |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | All 17 endpoints, auth, payloads, error envelope |
| [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | Collections, indexes, Atlas Vector Search, Redis keys |
| [docs/QUEUE_AND_WORKER_FLOW.md](docs/QUEUE_AND_WORKER_FLOW.md) | Queue/worker + SSE + sequence diagrams |
| [docs/SECURITY.md](docs/SECURITY.md) | Security posture report (auth, redaction, injection, limits) |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Local, Docker Compose, Atlas, Redis, GitHub Actions |
| [docs/ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md) | Every env var, defaults, and effect |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common failures and fixes |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Near-term hardening roadmap |
| [docs/FUTURE_ROADMAP.md](docs/FUTURE_ROADMAP.md) | v2 agents (log analysis, ChatOps, auto-remediation) |
| [docs/INTERVIEW_GUIDE.md](docs/INTERVIEW_GUIDE.md) | Architecture deep-dive + STAR interview answers |
| [docs/RESUME_PROJECT_DESCRIPTION.md](docs/RESUME_PROJECT_DESCRIPTION.md) | Resume bullets (1-line → detailed) |

## Repository layout

```
packages/shared   API↔web contract (types, error envelope, job/grounding types)
apps/api          Express API + BullMQ worker + LangChain-style orchestration
  src/auth        JWT + signed SSE tokens
  src/db          Mongo connector + index bootstrap
  src/features    redaction, chunker, sopStore, vectorMath, audit/budget, summary, rca
  src/llm         OpenAI client (+mock), orchestrator (redact→retrieve→fence→LLM)
  src/middleware  error envelope, requireMongo, rateLimit
  src/models      Mongoose schemas
  src/queue       BullMQ queue + worker
  src/routes      jobs, tickets, sops, rca
  src/integration real-DB integration tests
  atlas           Atlas Vector Search index definition
apps/web          React SPA — AIBlock trust UX, SSE streaming, 3 feature pages
.github/workflows CI: typecheck + tests (real Mongo + Redis) + web build
```

## Tests & CI

```bash
npm run typecheck    # tsc -b across all workspaces
npm test             # api unit + integration (integration needs MONGODB_URI)
```

CI (GitHub Actions) runs typecheck, the full test suite against **real `mongo:7`
+ `redis:7` services**, and the web build on every push/PR. `npm audit`: **0
vulnerabilities**.

## Status

**Feature-complete and frozen.** Core-3 built, reviewed (no open P1/P2), hardened
(rate limiting, signed SSE, budget meter, secret guard), CI-gated, and verified
against a real database. See [docs/ROADMAP.md](docs/ROADMAP.md) for the remaining
production-hardening checklist.

## License

MIT (reference/portfolio project).

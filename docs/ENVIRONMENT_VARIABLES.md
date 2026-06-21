# Environment Variables

All API/worker config is validated by zod at boot (`apps/api/src/config.ts`);
invalid config crashes fast with a clear message. Copy `.env.example` → `.env`.
The `.env` is loaded by walking up from the source dir, so it works from any
workspace cwd.

## LLM

| Variable | Default | Effect |
|----------|---------|--------|
| `LLM_MODE` | `mock` | `mock` = deterministic stub, no key/spend; `openai` = live API. |
| `OPENAI_API_KEY` | — | Required when `LLM_MODE=openai` (boot fails otherwise). |
| `OPENAI_CHAT_MODEL_SMALL` | `gpt-4o-mini` | Ticket summary (cheap tier). |
| `OPENAI_CHAT_MODEL_LARGE` | `gpt-4o` | RCA generation (capable tier). |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | SOP embeddings (1536-dim). |

## Data stores

| Variable | Default | Effect |
|----------|---------|--------|
| `MONGODB_URI` | `mongodb://localhost:27017/ops_copilot` | Mongo / Atlas SRV string. |
| `VECTOR_INDEX_NAME` | `sop_vector_index` | Atlas Vector Search index name. |
| `MONGO_SERVER_SELECTION_TIMEOUT_MS` | `5000` | Connect timeout; raise for Atlas latency, lower for fast local-degradation. |
| `EMBEDDING_DIMENSIONS` | `1536` | Must match the embedding model **and** the Atlas vector index. |
| `REDIS_URL` | `redis://localhost:6379` | Queue, events, rate limit, budget, mock SOP store. |

## Auth

| Variable | Default | Effect |
|----------|---------|--------|
| `JWT_SECRET` | — (min 16 chars) | HS256 signing secret. **Required.** The `.env.example` placeholder is rejected when `NODE_ENV=production`. |
| `JWT_ISSUER` | `ops-copilot` | `iss` claim, validated on verify. |

## Server

| Variable | Default | Effect |
|----------|---------|--------|
| `API_PORT` | `4000` | API listen port. |
| `WEB_ORIGIN` | `http://localhost:5173` | CORS allow-origin (must match the deployed web origin). |
| `NODE_ENV` | — | `production` activates the JWT placeholder guard. |

## Budget

| Variable | Default | Effect |
|----------|---------|--------|
| `TENANT_DAILY_TOKEN_BUDGET` | `2000000` | Per-tenant daily token cap; over → `budget_exceeded`. |

## Minimal `.env` examples

**Local, no key, no DB (mock):**
```env
LLM_MODE=mock
JWT_SECRET=local-dev-secret-please-change
```

**Production (Atlas + OpenAI):**
```env
NODE_ENV=production
LLM_MODE=openai
OPENAI_API_KEY=sk-...
MONGODB_URI=mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/ops_copilot?retryWrites=true&w=majority
REDIS_URL=rediss://default:PASS@host:6379
JWT_SECRET=<32+ random bytes from a secrets manager>
WEB_ORIGIN=https://copilot.example.com
TENANT_DAILY_TOKEN_BUDGET=5000000
```

> Put `JWT_SECRET` and `OPENAI_API_KEY` in a secrets manager, not a committed file.

# Deployment

The system is two Node processes (**API** + **worker**) plus a static **web**
bundle, backed by **MongoDB** and **Redis**. Run both Node processes; they share
Redis (queue/events) and MongoDB.

See [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) for every variable.

## 1. Local development

```bash
docker compose up -d            # Mongo + Redis (see §2)
npm install
cp .env.example .env            # LLM_MODE=mock → no key, no spend
npm run seed                    # demo tenant + prints a dev JWT
npm run dev                     # API :4000 + web :5173 (concurrently)
npm run worker                  # second terminal
# open http://localhost:5173, paste the JWT
```

- **Mock mode** (`LLM_MODE=mock`, default) runs the full flow — including SOP RAG
  via a Redis store — with no OpenAI key and no MongoDB.
- **Live LLM:** `LLM_MODE=openai` + `OPENAI_API_KEY`.
- The web dev server proxies `/api` → `http://localhost:4000` (see `vite.config.ts`).

## 2. Docker Compose (local infra)

`docker-compose.yml` provides Mongo + Redis for development:

```bash
docker compose up -d            # start
docker compose ps               # health
docker compose down             # stop (add -v to wipe data)
```

> Local Mongo has **no `$vectorSearch`**; SOP retrieval uses the cosine fallback.
> For vector search at scale, use MongoDB Atlas (§3).

A production compose would also run the API and worker as services (same image,
different command: `npm run dev:api` / `npm run worker`), behind a reverse proxy
that terminates TLS and sets `trust proxy`.

## 3. MongoDB Atlas

1. Create a cluster; add a database user and network access (IP allowlist / VPC).
2. Set the connection string:
   ```
   MONGODB_URI="mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/ops_copilot?retryWrites=true&w=majority"
   ```
   `MONGO_SERVER_SELECTION_TIMEOUT_MS` defaults to 5000 (Atlas needs more than a
   local socket).
3. Create indexes:
   ```bash
   npm run -w @ops-copilot/api db:indexes
   ```
   This builds the collection indexes everywhere and creates the **Atlas Vector
   Search** index `sop_vector_index` on `sops.embedding` (definition:
   [`apps/api/atlas/sop_vector_index.json`](../apps/api/atlas/sop_vector_index.json)).
   It also auto-creates best-effort on first boot. `EMBEDDING_DIMENSIONS` (1536)
   must match your embedding model.
4. Verify with the integration tests (point `MONGODB_URI` at the cluster):
   ```bash
   npm test    # src/integration/realdb.test.ts runs when a DB is reachable
   ```

## 4. Redis

Required for the queue, SSE events, rate limiting, the budget meter, and the
no-Mongo SOP store. Any Redis 7 works (managed: ElastiCache, Upstash, Redis
Cloud). Set `REDIS_URL`. For production: enable persistence/HA; size for queue
depth + counters (small).

## 5. GitHub Actions CI

`.github/workflows/ci.yml` runs on every push/PR with **real `mongo:7` + `redis:7`
services**:

```yaml
services:
  redis: { image: redis:7, ports: ["6379:6379"] }
  mongo: { image: mongo:7, ports: ["27017:27017"] }
env:
  REDIS_URL: redis://localhost:6379
  MONGODB_URI: mongodb://localhost:27017/ops_copilot_ci
  LLM_MODE: mock
steps:
  - npm ci
  - npm run typecheck          # tsc -b all workspaces
  - npm test                   # unit + integration (real DB)
  - npm run -w @ops-copilot/web build
```

The integration tests exercise persistence + retrieval against the real Mongo
service; they **skip** automatically when no DB is reachable.

## Production process model

```
            ┌── reverse proxy (TLS, trust proxy) ──┐
 web (CDN)  │                                       │
 ───────────┤  API  (npm run dev:api → compiled)    ├── MongoDB Atlas
            │  Worker x N (npm run worker)          ├── Redis (HA)
            └───────────────────────────────────────┘── OpenAI
```

- Scale the **worker** horizontally for LLM throughput (concurrency 4 per
  process); the budget meter + rate limiter are Redis-shared, so limits hold
  across replicas.
- Put `JWT_SECRET` / `OPENAI_API_KEY` in a secrets manager, not `.env`.
- Set `NODE_ENV=production` (activates the JWT placeholder guard) and a strong
  `JWT_SECRET`.
- `WEB_ORIGIN` must match the deployed web origin (CORS).

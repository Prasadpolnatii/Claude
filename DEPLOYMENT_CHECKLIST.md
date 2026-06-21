# Deployment Checklist

Step-by-step checklists per environment. Detailed guidance: `docs/DEPLOYMENT.md`,
`docs/ENVIRONMENT_VARIABLES.md`.

Two Node processes (**API** + **worker**) + a static **web** bundle, backed by
**MongoDB** and **Redis**. Always run both Node processes.

## Local deployment

- [ ] Node 20+ and Docker installed.
- [ ] `docker compose up -d` (Mongo + Redis); `docker compose ps` healthy.
- [ ] `npm install`.
- [ ] `cp .env.example .env` (defaults: `LLM_MODE=mock`, local Mongo/Redis).
- [ ] Set `JWT_SECRET` (≥16 chars).
- [ ] `npm run seed` → copy the printed dev JWT.
- [ ] `npm run dev` (API :4000 + web :5173) and `npm run worker` (2nd terminal).
- [ ] Open http://localhost:5173, paste the JWT; verify a ticket summary streams.
- [ ] (Optional) `LLM_MODE=openai` + `OPENAI_API_KEY` for live output.

## Docker deployment

- [ ] `docker-compose.yml` runs Mongo + Redis (dev). For full containerization,
      add API + worker services from the same image with commands
      `npm run dev:api` and `npm run worker`.
- [ ] Front the API with a reverse proxy that terminates TLS.
- [ ] Set `trust proxy` appropriately (already `loopback`; widen if behind a known
      proxy) so `req.ip` (rate limiter) is correct.
- [ ] Pass env via secrets, not baked into the image.
- [ ] Scale the **worker** service horizontally for LLM throughput.
- [ ] Persist Mongo + Redis volumes (or use managed services, below).

## MongoDB Atlas setup

- [ ] Create a cluster; create a DB user with least privilege.
- [ ] Network access: IP allowlist / VPC peering / private endpoint.
- [ ] `MONGODB_URI="mongodb+srv://USER:PASS@cluster.xxxxx.mongodb.net/ops_copilot?retryWrites=true&w=majority"`.
- [ ] Keep `MONGO_SERVER_SELECTION_TIMEOUT_MS=5000` (Atlas latency).
- [ ] `npm run -w @ops-copilot/api db:indexes` → builds collection indexes + the
      Atlas Vector Search index `sop_vector_index` (def:
      `apps/api/atlas/sop_vector_index.json`).
- [ ] Confirm `EMBEDDING_DIMENSIONS=1536` matches the embedding model + index.
- [ ] Verify: point `MONGODB_URI` at the cluster and run `npm test` (integration
      tests run when a DB is reachable).
- [ ] Confirm `GET /api/health` → `"mongo":"connected"`.

## Redis setup

- [ ] Provision Redis 7 (managed: ElastiCache / Upstash / Redis Cloud).
- [ ] `REDIS_URL="rediss://default:PASS@host:6379"` (TLS in prod).
- [ ] Enable persistence (AOF/RDB) and HA/replication.
- [ ] Size for queue depth + counters (modest); set an eviction policy that won't
      drop queue keys (e.g. `noeviction` for the queue instance).

## Environment variables

- [ ] All required vars set (boot fails fast on invalid config):
      `JWT_SECRET`, `MONGODB_URI`, `REDIS_URL`, and `OPENAI_API_KEY` if
      `LLM_MODE=openai`.
- [ ] `NODE_ENV=production` (activates the JWT placeholder guard).
- [ ] `WEB_ORIGIN` = the deployed web origin (CORS).
- [ ] `TENANT_DAILY_TOKEN_BUDGET` tuned for expected usage.
- [ ] Model tiers (`OPENAI_CHAT_MODEL_SMALL/LARGE`, `OPENAI_EMBEDDING_MODEL`) as
      desired. Full table: `docs/ENVIRONMENT_VARIABLES.md`.

## Production secrets

- [ ] `JWT_SECRET` = 32+ random bytes from a **secrets manager** (Vault / AWS
      Secrets Manager / Doppler) — **never** the `.env.example` placeholder (the
      app refuses it in production).
- [ ] `OPENAI_API_KEY`, DB/Redis credentials in the secrets manager, injected at
      runtime.
- [ ] Rotate secrets on a schedule; restrict access by role.
- [ ] Confirm `.env` is gitignored (it is) and never shipped in images/logs.

## Monitoring

- [ ] Liveness/readiness probe on `GET /api/health` (checks `mongo` state).
- [ ] Metrics: job throughput, queue depth, job failure rate by `code`, p95
      latency, SSE connection count, OpenAI spend, rate-limit 429s, budget hits.
- [ ] Alerts: failure-rate spike, queue backlog, Mongo/Redis down, budget
      exhaustion, error-rate by tenant.
- [ ] Tracing (OpenTelemetry) across API → queue → worker → OpenAI/Mongo stages.

## Logging

- [ ] Structured JSON logs (e.g. pino); include `tenantId`, `jobId`, job `type`,
      `code` — **never** ticket/log content or secrets (redaction protects the
      model path; keep app logs clean too).
- [ ] Ship to a central store; retain per policy.
- [ ] The redaction audit (`redactionaudits`) provides a compliance trail of what
      was scrubbed.

## Backup strategy

- [ ] MongoDB Atlas continuous backups / point-in-time recovery; test a restore.
- [ ] Redis: queue state is transient, but enable persistence so in-flight jobs
      survive a restart; budget/rate counters are reconstructable (daily windows).
- [ ] Document RPO/RTO and a restore runbook.
- [ ] Dead-letter handling for jobs that exhaust retries (deferred — see ROADMAP).

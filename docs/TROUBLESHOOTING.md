# Troubleshooting

## API won't start

| Symptom | Cause | Fix |
|---------|-------|-----|
| `[config] invalid environment` | missing/invalid env var | check the field list; copy `.env.example` → `.env`. |
| `JWT_SECRET must be at least 16 chars` | short/empty secret | set a ≥16-char `JWT_SECRET`. |
| `JWT_SECRET is the shipped placeholder` (prod exit) | placeholder secret with `NODE_ENV=production` | set a unique secret. |
| `LLM_MODE=openai requires OPENAI_API_KEY` | live mode, no key | set `OPENAI_API_KEY` or use `LLM_MODE=mock`. |
| `Cannot bind … 127.0.0.1` | port in use | free `API_PORT` (4000) or change it. |

## "Database unavailable" (503) on tickets/RCA-save

`db_unavailable` means MongoDB isn't connected. The API runs **degraded** without
Mongo: health + jobs + SOP search work; ticket/RCA persistence needs a DB.
- Start Mongo (`docker compose up -d`) or set a reachable `MONGODB_URI`.
- Check `GET /api/health` → `"mongo": "connected"`.
- Atlas timeouts: raise `MONGO_SERVER_SELECTION_TIMEOUT_MS`; verify IP allowlist
  and that the SRV string is correct.

## SSE stream hangs / no result

- **401 on the stream:** you used the session JWT in `?access_token` — that's no
  longer accepted. Call `GET /jobs/:id/stream-token` first, then
  `?t=<streamToken>`.
- **403:** the stream token's `jobId` doesn't match the path — mint a token for
  the right job.
- **Token expired:** stream tokens live 60 s; re-mint.
- **No `token` events for ticket/RCA:** expected — JSON-mode features stream none
  (you get the result on `done`). Only SOP search streams prose tokens.

## SOP search returns nothing / low scores

- **Empty results:** no SOPs uploaded for that tenant. Upload via `/sops/upload`
  or `POST /sops`.
- **Low similarity in mock mode:** mock embeddings are crude pseudo-vectors;
  scores are low but retrieval works. Use `LLM_MODE=openai` for real embeddings.
- **`$vectorSearch` errors on local Mongo:** expected — local Mongo has no vector
  search; the code falls back to cosine. Use Atlas + `db:indexes` for real vector
  search.

## Jobs fail immediately

Check the SSE `error` event / `GET /jobs/:id` `error.code`:
- `redaction_failed` — a redaction error aborted the call (fail-closed). Not
  retryable without a fix.
- `budget_exceeded` — tenant hit `TENANT_DAILY_TOKEN_BUDGET`. Raise it or wait for
  the daily window.
- `llm_unavailable` — OpenAI error or invalid JSON; retryable.
- `db_unavailable` — SOP/RCA path needed Mongo. Bring Mongo up.

## Rate limited (429)

You exceeded 30 generative requests/60 s per tenant (or 300/60 s per IP). Respect
`Retry-After`. Limits are Redis-backed; check `X-RateLimit-Remaining`.

## Tests

- **Integration tests skip** (`# SKIP no MongoDB reachable`) — expected without a
  DB. Set `MONGODB_URI` to a running Mongo to run them.
- **Runner hangs** — ensure Redis is reachable; the suite uses `--test-force-exit`
  so a live Redis handle won't block exit. Grounding/integration tests skip
  cleanly when Redis/Mongo are absent.
- **`tsc -b` says "not built from source"** — stale `.tsbuildinfo`; run
  `npx tsc -b --force` or delete `dist/` + `*.tsbuildinfo`.

## CI red

- **`npm ci` fails** — lockfile out of sync; run `npm install` and commit
  `package-lock.json`.
- **Integration step fails** — read the `mongo`/`Test (api)` logs; the Mongo
  service container logs show real collection/index activity.

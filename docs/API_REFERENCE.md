# API Reference

Base URL: `http://localhost:4000` (dev). All responses are JSON.

## Authentication

Most endpoints require `Authorization: Bearer <JWT>`. The JWT (HS256) carries
`tenantId`, `sub` (user id), and `role`. Mint one in dev with `npm run seed`.

The SSE stream endpoint instead takes a **short-lived (60 s), job-scoped stream
token** in the `?t=` query param (because `EventSource` can't send headers).

## Error envelope

Every error has the same shape; clients branch on `retryable`:

```json
{ "error": { "code": "rate_limited", "message": "…", "retryable": true } }
```

| Code | HTTP | Retryable | Meaning |
|------|------|-----------|---------|
| `bad_request` | 400 | no | validation failure |
| `unauthorized` | 401 | no | missing/invalid token |
| `forbidden` | 403 | no | stream-token job mismatch |
| `not_found` | 404 | no | resource (or cross-tenant) not found |
| `rate_limited` | 429 | yes | rate limit exceeded (`Retry-After` header) |
| `budget_exceeded` | (job) | no | tenant daily token budget spent |
| `redaction_failed` | (job) | no | redaction error → LLM call aborted (fail-closed) |
| `llm_unavailable` | (job) | yes | model error / invalid JSON |
| `db_unavailable` | 503 | yes | MongoDB unreachable (Mongo-only routes) |
| `internal` | 500 | yes | unexpected error |

`(job)` codes surface in the SSE `error` event / `GET /jobs/:id`, not as an HTTP status on submit.

## Rate limits

- Global: **300 requests / 60 s per IP** on all `/api`.
- Generative: **30 / 60 s per tenant** on submit endpoints.
- 429 responses include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`.

---

## Health

### `GET /api/health` · no auth
```json
{ "ok": true, "llmMode": "mock", "mongo": "connected" }
```
`mongo`: `disconnected` | `connecting` | `connected`.

---

## Jobs (async generative)

### `POST /api/jobs` · bearer · rate-limited
Generic job submit. Body is a discriminated union on `type`:
```json
{ "type": "ticket_summary", "input": { "ticketText": "…" } }
{ "type": "sop_search",     "input": { "query": "…" } }
{ "type": "rca",            "input": { "incidentSummary": "…", "logSnippet": "…" } }
```
Optional `Idempotency-Key` header dedupes double-submits. → `202 { "jobId": "…" }`

### `GET /api/jobs/:id` · bearer
Poll status/result. Returns a `Job`:
```json
{ "id":"…","tenantId":"…","type":"ticket_summary","status":"succeeded",
  "createdAt":"…","updatedAt":"…","result":{ … },"error": null }
```
`status`: `queued` | `running` | `succeeded` | `failed`. Tenant-scoped (a job from
another tenant is a 404).

### `GET /api/jobs/:id/stream-token` · bearer
Mint a 60 s stream token bound to this job. → `{ "streamToken":"…","expiresIn":60 }`

### `GET /api/jobs/:id/stream?t=<streamToken>` · stream token · SSE
`Content-Type: text/event-stream`. Events:
```
data: {"type":"status","status":"running"}
data: {"type":"token","text":"…"}       // prose answers only (SOP search)
data: {"type":"done","job":{…}}
data: {"type":"error","error":{…}}
```

---

## Tickets · all require MongoDB (503 when down)

### `GET /api/tickets` · bearer
Tenant ticket inbox (latest 50).

### `POST /api/tickets` · bearer
Ingest a ticket: `{ "title":"…","body":"…","externalId?":"…" }` → `201 { ticket }`.

### `POST /api/tickets/:id/summarize` · bearer · rate-limited
Enqueue a summary for a stored ticket. Optional `Idempotency-Key`.
→ `202 { "jobId":"…","ticketId":"…" }`

### `GET /api/tickets/:id/summary` · bearer
Saved (possibly human-edited) summary, or `{ "summary": null }`.

### `PUT /api/tickets/:id/summary` · bearer
Persist the reviewed summary (upsert, one per ticket):
```json
{ "headline":"…","summary":"…","impact":"…","nextActions":["…"],
  "editedByHuman": true, "jobId?":"…" }
```

---

## SOPs · Mongo-optional (Redis store in mock mode)

### `POST /api/sops/upload` · bearer · rate-limited · multipart
Field `file` (PDF/.md/.txt, ≤10 MB), optional `title`. Extracts → chunks →
embeds → stores. → `201 { "document":"…","chunks":N,"characters":N }`

### `POST /api/sops` · bearer
Add a runbook section directly: `{ "title":"…","text":"…" }` → `201 { document, chunks }`.

### `POST /api/sops/search` · bearer · rate-limited
Grounded answer (async). `{ "query":"…" }` → `202 { "jobId":"…" }` (stream for the answer).

### `GET /api/sops/search?q=…` · bearer
Fast raw retrieval (no LLM): `{ "hits":[{ id,title,text,score }] }`.

---

## RCA

### `POST /api/rca/generate` · bearer · rate-limited · Mongo-optional
`{ "incidentSummary":"…","logSnippet?":"…","incidentId?":"…" }` → `202 { "jobId":"…" }`.

### `POST /api/rca` · bearer · **requires MongoDB**
Persist a reviewed RCA (upsert by `incidentId` when provided):
```json
{ "title":"…","rootCause":"…","contributingFactors":["…"],"timeline":["…"],
  "remediation":["…"],"confidence?":0.0,"citations?":[…],"editedByHuman":true,"incidentId?":"…" }
```

### `GET /api/rca/:id` · bearer · **requires MongoDB**
Fetch a saved RCA by id (tenant-scoped).

---

## GroundedResult shape

Job results for `ticket_summary` / `sop_search` / `rca`:
```json
{ "data": { … feature-specific … },
  "citations": [ { "kind":"sop|log|ticket","label":"…","ref":"…","snippet":"…" } ],
  "confidence": 0.0,        // 0–1; below 0.55 the UI flags "low confidence"
  "model": "gpt-4o-mini",
  "redacted": true }        // true when PII was scrubbed before the model call
```

# Roadmap (near-term hardening)

Feature development is **frozen**. The core-3 is built, reviewed (no open P1/P2),
hardened, CI-gated, and verified against a real database. This is the remaining
production-hardening checklist. For v2 product features see
[FUTURE_ROADMAP.md](FUTURE_ROADMAP.md).

## Done

- [x] Async job queue + SSE (no LLM in request handlers)
- [x] Fail-closed PII redaction before every model call
- [x] Prompt-injection fencing (per-call nonce)
- [x] Multi-tenant isolation (data + Redis keys + job ownership)
- [x] JWT auth (HS256 pinned) + short-lived signed SSE tokens
- [x] Redis rate limiting (per-IP + per-tenant) and token budget meter
- [x] Uniform error envelope with correct `retryable`
- [x] Graceful degradation without MongoDB
- [x] Index bootstrap + Atlas Vector Search index definition
- [x] CI: typecheck + unit + integration (real Mongo + Redis) + web build
- [x] `npm audit`: 0 vulnerabilities; placeholder-secret guard

## Next (infrastructure)

- [ ] **Run once against a real Atlas cluster** — provision, `db:indexes`, smoke
      the `$vectorSearch` path end-to-end (CI uses plain `mongo:7` → cosine
      fallback).
- [ ] **Secrets manager** for `JWT_SECRET` / `OPENAI_API_KEY` (not `.env`).
- [ ] **Observability** — structured logging (pino), metrics (Prometheus),
      tracing (OpenTelemetry), and alerting (job failure rate, p95 latency, cost).
- [ ] **Security headers** — `helmet`, CSP; map multer `LIMIT_FILE_SIZE` → 413;
      consider httpOnly-cookie auth + CSRF instead of `localStorage`.
- [ ] **Dead-letter handling** — route poisoned jobs to a DLQ after max attempts;
      surface them for inspection.
- [ ] **Backups / DR** — Atlas PITR; Redis persistence/HA; restore runbook.

## Next (product quality)

- [ ] **Real-embedding eval suite** — measure retrieval precision / grounding /
      citation accuracy with `text-embedding-3-small`; LLM-as-judge faithfulness.
- [ ] **Cost controls** — per-tenant budgets tuned; response caching by content
      hash; pre-reservation (estimate tokens before spend).
- [ ] **Persist generated drafts** — currently the draft lives in the job result
      (1 h) until the human saves; optionally auto-persist a draft state.
- [ ] **SOP lifecycle** — re-index on runbook change (`embeddingVersion`), dedupe
      re-uploads, show index age.
- [ ] **UX** — citation deep-links, diff view on edit, keyboard-first nav,
      streaming stop button, empty/error-state polish.

## Known limitations (accepted for this version)

- Cosine fallback is O(n) over `Sop.find()` — dev/non-Atlas only.
- SOPs uploaded in no-Mongo mock mode (Redis) aren't migrated when Mongo later
  comes up (mode split). Irrelevant for an always-on Atlas deployment.
- Budget meter is check-before + record-after (eventually consistent), not a hard
  pre-reservation.
- Redaction is regex best-effort (pair with provider-side DLP for compliance).

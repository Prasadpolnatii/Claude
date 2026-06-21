# Security Posture Report

Reference implementation hardened across authn/z, LLM-specific risks, abuse
controls, and the dependency supply chain. **`npm audit`: 0 vulnerabilities.**
No open P1/P2 from the internal `/review` + `/cso` passes.

## Summary

| Control | Status |
|---------|--------|
| Tenant isolation | ✅ every query/key tenant-scoped; job ownership enforced |
| JWT auth | ✅ HS256 pinned, header-only, placeholder-secret guard |
| Signed SSE tokens | ✅ 60 s, single-purpose, job-bound |
| Prompt-injection defense | ✅ per-call nonce fencing; output never executed |
| Redaction proxy | ✅ fail-closed before every OpenAI call |
| Rate limiting | ✅ Redis, per-IP + per-tenant |
| Budget meter | ✅ Redis, shared, check-before-spend |
| NoSQL injection | ✅ zod + ObjectId validation; no req objects in filters |
| Dependency audit | ✅ 0 vulns (removed unused vulnerable dep) |
| Secrets | ✅ none hardcoded; `.env` gitignored, never committed |

## Tenant isolation

Multi-tenant from day one. `tenantId` is required on **every** document and is
part of **every** query filter. Cross-tenant access is impossible by construction:

- Mongo reads/writes always filter `{ tenantId, … }` (e.g. `Rca.findOne({ _id, tenantId })`).
- A job created by tenant A is a **404** for tenant B (`loadOwnedJob` checks `job.data.tenantId`).
- Redis keys are tenant-namespaced: `budget:{tenant}:…`, `sops:mock:{tenant}`, `rl:t:{tenant}:…`.
- Unique indexes are compound on `tenantId` (`(tenantId, ticketId)`, `(tenantId, email)`).

## JWT authentication

- **HS256, algorithm pinned** (`algorithms: ["HS256"]`) — the verifier never
  honors the `alg` a token claims, blocking algorithm-confusion attacks.
- **Header-only** for API requests (`Authorization: Bearer`).
- Carries `tenantId`, `sub`, `role`; `issuer` validated.
- **Placeholder-secret guard:** the public `.env.example` default secret is
  rejected when `NODE_ENV=production` (warns in dev) — prevents shipping with a
  forgeable secret.

## Signed SSE tokens

`EventSource` can't send headers, so streaming used to need the session JWT in the
URL (logs/history leak). Replaced with a dedicated flow:

1. `GET /jobs/:id/stream-token` (header auth) → a **60 s** token with
   `purpose: "sse"` bound to that **one job id**.
2. The stream route verifies `purpose=sse` **and** `jobId == :id` (else 403).

A leaked stream URL expires in a minute and unlocks only that job's stream — the
12 h session token is never exposed in a URL.

## Prompt-injection defense

Tickets, logs, and runbooks are untrusted text fed into prompts. Defenses:

- **Per-call random nonce fence:** untrusted content is wrapped in
  `<UNTRUSTED id="<nonce>"> … </UNTRUSTED id="<nonce>">`; literal `UNTRUSTED`
  tags inside the body are neutralized, so content can't forge the closing tag.
- **Authoritative-boundary instruction:** the system prompt tells the model only
  the matching-nonce boundary is real and to never follow embedded instructions.
- **No execution path:** model output is rendered/persisted, never passed to a
  shell or command executor. The red-team suite (`evals/injection.test.ts`)
  asserts adversarial "ignore your instructions" text survives as inert data.

## Redaction proxy (PII egress control)

`features/redaction.ts` scrubs emails, IPv4, bearer/JWT/OpenAI tokens, AWS keys,
private keys, and card-shaped numbers, replacing them with stable placeholders
(`[REDACTED:email#1]`) so the model can still co-refer.

- Runs before **every** OpenAI call — chat *and* embeddings (including the SOP
  search query embed).
- **Fail-closed:** a redaction error throws `redaction_failed` and the LLM call is
  aborted — unredacted text never reaches the provider.
- Every pass is logged to `redactionaudits` (compliance trail).

SOP *content* is the trusted knowledge base and is intentionally embedded as-is.

## Rate limiting

Redis fixed-window limiter (`middleware/rateLimit.ts`), shared across processes:

- Global **300 / 60 s per IP** on all `/api` (flood guard).
- **30 / 60 s per tenant** on generative submit endpoints.
- Keyed by tenant when authenticated, else IP. 429 uses the uniform envelope with
  `X-RateLimit-*` + `Retry-After`. **Fails open** on a Redis error.

## Token budget meter

Per-tenant daily token counter in Redis (`budget:{tenant}:{day}`), shared across
all worker processes. Checked **before** a job spends; recorded **after** the
call. Over budget → `budget_exceeded` (non-retryable). Fails open.

## NoSQL injection protection

- All request bodies are validated by **zod** before reaching a query; fields are
  coerced to strings/arrays/numbers, so no operator object (`{$gt:…}`) can be
  injected into a filter.
- Path ids are validated with `mongoose.isValidObjectId` before use.
- Query filters interpolate only validated primitives + the auth-derived
  `tenantId` — never a raw request object.

## Dependency & secrets audit

- **`npm audit`: 0 vulnerabilities.** Removed `@langchain/openai` (declared but
  never imported) which transitively pulled `langsmith` with HIGH SSRF +
  prototype-pollution advisories.
- `.env` is gitignored and was never committed (verified via git history).
- No hardcoded secrets; the dev JWT helper (`signDevToken`) is used only by the
  seed script, never exposed as a route.
- CI runs `npm ci` from a committed lockfile.

## Residual risks (P3, accepted)

| Risk | Mitigation / note |
|------|-------------------|
| Session JWT in `localStorage` (SPA) | XSS could steal it; mitigated by short-lived stream tokens. Consider httpOnly cookies + CSRF for hardening. |
| Multer `LIMIT_FILE_SIZE` → generic 500 | 10 MB cap enforced; map to 413 for polish. |
| Untrusted PDF parsing (unpdf/pdfjs) | bounded by 10 MB; consider page/time limits. |
| Redaction is regex best-effort | won't catch every PII format; pair with provider-side controls / DLP for compliance. |
| No security headers (helmet/CSP) | add for production (see ROADMAP). |

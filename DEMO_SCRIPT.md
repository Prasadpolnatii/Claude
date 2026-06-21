# Demo Script — AI Operations Copilot

Scripts for showing the project live (or recorded). Run in **mock mode** for a
zero-dependency demo: no OpenAI key, no database needed.

**Setup (once):**
```bash
docker compose up -d        # or skip Mongo; mock mode tolerates it
npm install && cp .env.example .env
npm run seed                # prints a dev JWT
npm run dev                 # API + web
npm run worker              # 2nd terminal
```
Open http://localhost:5173 and paste the JWT.

---

## 5-minute demo

> Goal: show the product working and the one idea that makes it different —
> **grounded, human-in-the-loop AI**.

1. **(0:30) Frame it.** "On-call engineers spend most of an incident triaging, not
   fixing. This copilot summarizes tickets, answers from runbooks, and writes RCAs —
   but every answer is **cited, confidence-scored, and edited by a human before it's
   saved**."
2. **(1:30) Ticket Summarization.** Incident Workspace → pick a ticket → **Summarize**.
   Point out: the streamed result, the **citation** to the source, the **confidence
   score**, the **"verify before acting"** badge.
3. **(1:00) Edit-before-save.** Click **Edit first**, change a line, **Save**. Note the
   "human-edited" marker — "AI output is a draft, not a decision."
4. **(1:30) SOP Search (RAG).** SOP Search tab → **Upload** a runbook → ask a question →
   **Grounded answer** streams with a **SOP citation**. "It answers only from your
   runbooks; if nothing matches, it says so instead of hallucinating."
5. **(0:30) Close.** "All async — the API enqueues a job and streams results over SSE —
   with PII redaction, multi-tenancy, and rate limiting underneath. Zero npm
   vulnerabilities, CI tests against a real database."

---

## 15-minute interview demo

> Goal: product + the engineering depth. Keep the app on screen; switch to
> `docs/` diagrams when explaining internals.

1. **(2:00) Problem & product.** As above; run one ticket summary end to end.
2. **(2:00) RCA Generation.** RCA tab → incident + log snippet → **Generate**. Show the
   RCA grounded in **both the log and a SOP** (two citation kinds), confidence, then
   edit + save. "This composes the other two features."
3. **(3:00) Architecture.** Open `docs/ARCHITECTURE.md`. Walk the diagram: API enqueues
   `202 + jobId`, worker runs **redact → retrieve → fence → LLM → validate**, SSE streams
   back. "Async because calls take 10–60s; two processes share Redis + Mongo."
4. **(3:00) Security deep-dive.** Open `docs/SECURITY.md`. Pick two: **fail-closed
   redaction** (PII never reaches OpenAI, aborts on error) and **prompt-injection
   fencing** (per-call nonce; output never executed). Mention multi-tenancy + signed
   SSE tokens.
5. **(2:00) Reliability & scale.** Redis-shared rate limiting + budget meter (correct
   across replicas); stateless API + horizontal workers; graceful DB degradation —
   "kill Mongo and health + jobs still work."
6. **(2:00) Engineering rigor.** CI runs typecheck + tests against **real `mongo:7`/`redis:7`**;
   `npm audit` 0; internal review caught a redaction bypass + a HIGH-severity unused
   dependency. "Most bugs surfaced from running it for real, not static review."
7. **(1:00) Q&A handoff.** Point to `INTERVIEW_QA.md`.

---

## Feature walkthrough (reference)

| Feature | Click path | What to highlight |
|---------|-----------|-------------------|
| Ticket Summarization | Incident Workspace → ticket → Summarize → Edit → Save | citation, confidence, edit-before-save, upsert |
| SOP Search (RAG) | SOP Search → Upload → query → Grounded answer | chunk/embed/retrieve, SOP citation, "no source" honesty |
| RCA Generation | RCA → incident + log → Generate → Edit → Save | log **and** SOP citations, schema-validated output |

Cross-cutting to point out anywhere: streamed output, the `AIBlock` trust chrome,
and that nothing is saved without a human action.

## Architecture explanation (talk track)

"Two processes share Redis and MongoDB. The **Express API** authenticates,
rate-limits, validates, and **enqueues a job** — it returns a `jobId` immediately
and never blocks on the model. A **BullMQ worker** runs one pipeline for all three
features: it **redacts** PII, **retrieves** grounding via vector search, **fences**
the untrusted content against prompt injection, calls the LLM, and **validates** the
JSON against a schema. The browser streams progress over **SSE** using a 60-second,
job-scoped token. It **degrades gracefully** — the API boots without MongoDB, and a
mock mode runs the whole thing with no API key, which is also how it's tested in CI."

## STAR stories

**Async pipeline.**
- **S:** LLM calls take 10–60s; the UI needed live progress.
- **T:** Serve generative features without blocking or timing out.
- **A:** API enqueues to BullMQ/Redis (`202 + jobId`); a worker runs the
  orchestration and streams over SSE; added terminal-event replay for the
  fast-job/subscribe race.
- **R:** Responsive API, independently scalable workers, live streaming; verified
  in mock mode and against real services in CI.

**Fail-closed redaction.**
- **S:** Tickets/logs contain PII that would otherwise reach OpenAI.
- **T:** Guarantee no PII egress.
- **A:** One redaction chokepoint before every call (chat + embeddings), stable
  placeholders, **aborts** on error, audit-logged; red-team tests.
- **R:** No egress path; a search-query embed gap was caught in review and closed.

**Error propagation through the queue.**
- **S:** Failed jobs reached the UI as generic retryable `internal`.
- **T:** Surface the true failure class + `retryable`.
- **A:** BullMQ only persists a string, so the worker classifies failures into an
  `ApiError` and JSON-encodes it; the SSE layer decodes it.
- **R:** A non-retryable `redaction_failed` is no longer mislabeled; verified by
  forcing a `budget_exceeded` job.

**Dependency vulnerability.**
- **S:** `npm audit` reported a HIGH SSRF + prototype-pollution chain.
- **T:** Remove it without breaking the build.
- **A:** Traced it to `langsmith` via `@langchain/openai` — **declared but never
  imported**; removed the dependency.
- **R:** `npm audit` 3 → **0**; smaller install; no code change.

**Real-DB verification under constraints.**
- **S:** The build sandbox couldn't reach MongoDB Atlas (egress-blocked).
- **T:** Still verify DB-backed flows against a real database.
- **A:** Made the app Atlas-ready (config, index bootstrap, vector-index def) and
  added integration tests gated on `MONGODB_URI`, then wired a real `mongo:7`
  service into CI.
- **R:** CI confirmed real collection + index creation and verified persistence +
  retrieval; Atlas `$vectorSearch` documented as a one-time config step.

# Future Roadmap (v2 product)

The v1 core-3 is frozen. These are the next agents/features. All build on the
existing primitives — async job queue, SSE streaming, the orchestrator
(redact → retrieve → fence → LLM → validate), grounding + citations, the dual-mode
store, and the trust-UX `AIBlock` — so each is mostly a new job type + retrieval
source + UI surface, not new infrastructure.

These were intentionally deferred at the planning stage: the two riskiest
(command recommendations, log-stream analysis) carry the most operational risk and
were held back until the grounded core proved out.

## 1. Log stream analysis

**What:** ingest live log streams (not just pasted snippets) and surface anomalies,
error clusters, and likely-relevant lines for an incident.

**Why deferred:** logs are huge — this is its own retrieval/pre-aggregation
problem, not a prompt. Doing it naively blows the context window and the budget.

**Approach:** a streaming ingestion path (e.g. a log shipper → object store +
index); pre-aggregate and embed log windows; retrieve the top-k relevant windows
into the RCA/SOP pipelines. Reuse the chunker + vector store; add a `log_search`
job type. Tier models (cheap for triage, capable for synthesis) and cap tokens per
incident.

## 2. Command recommendation agent

**What:** suggest remediation commands (kubectl, CLI, runbook steps) grounded in
the incident + SOPs.

**Why deferred (and constrained):** recommending commands that could run in prod
is the highest-liability feature. Ships **advisory-only**.

**Guardrails (hard requirements):**
- **Never executes** — copy-to-clipboard with an explicit "review in your terminal"
  warning; no run button.
- Grounded in retrieved SOPs with citations; low-confidence answers say so.
- Dry-run framing; destructive-command detection + extra confirmation copy.
- Full audit trail of what was suggested and to whom.

## 3. Email/comms drafting agent

**What:** draft stakeholder updates and incident comms from the summary/RCA.

**Why simple:** mostly a template over the existing summarizer — folds into the
summarization service rather than being a separate subsystem.

**Approach:** a `comms_draft` job type that takes the (saved) summary/RCA + an
audience/tone parameter and produces an editable draft. Human-in-the-loop edit +
explicit Send (never auto-send). Reuse `AIBlock` + edit-before-save.

## 4. ChatOps assistant

**What:** a Slack/Teams bot that runs the copilot from where on-call already lives
— "/copilot summarize INC-123", "/copilot ask runbooks how do I fail over the DB".

**Approach:** a thin chat adapter that authenticates the workspace→tenant, calls
the existing job endpoints, and streams results back into the thread. The async
job model maps naturally to chat (post "working…", edit the message on `done`).
Reuse rate limits + budgets per tenant. No new core logic.

## 5. Auto-remediation advisor

**What:** the most ambitious — close the loop from detection → diagnosis →
*recommended* remediation, with optional gated execution behind strict policy.

**Why last:** combines log analysis, RCA, command recommendations, and a policy
engine. Highest blast radius.

**Approach (phased):**
1. **Advisor** — given an alert, auto-run RCA + command recommendations, post to
   ChatOps for a human to act. (No execution.)
2. **Gated execution** — allow only allowlisted, reversible actions behind
   explicit human approval + policy checks + full audit + automatic rollback
   criteria.
3. **Learning** — feed resolved incidents back as grounding to improve future
   recommendations.

Execution is opt-in, policy-bound, and reversible by design — never autonomous on
production by default.

---

## Cross-cutting (enables the above)

- **Eval harness** with real embeddings — retrieval precision, grounding/citation
  accuracy, injection red-team, faithfulness (LLM-as-judge).
- **Cost & caching** — response cache by content hash; token pre-reservation;
  per-tenant budget dashboards.
- **Connectors** — PagerDuty / Datadog / Jira / GitHub ingestion as additional
  grounding sources.
- **Observability & policy** — tracing across job stages; a policy engine for the
  agents above.

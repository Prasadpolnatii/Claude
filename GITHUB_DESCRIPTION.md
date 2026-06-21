# GitHub Description

Copy-paste metadata for the GitHub repository page (About, topics, social preview).

## Repository description (the "About" field, ≤ 350 chars)

> Multi-tenant AI copilot for on-call engineers: grounded ticket summaries, SOP
> search (RAG), and RCA generation. Async BullMQ/Redis jobs with SSE streaming,
> MongoDB Atlas Vector Search, fail-closed PII redaction, prompt-injection
> defense, rate limiting, and signed SSE tokens. TypeScript · 0 npm vulns ·
> CI with real-DB tests.

## Short description (one line)

> Grounded, async AI copilot for on-call engineers — RAG + LLM jobs with
> production-grade safety, multi-tenancy, and CI tested against a real database.

## Topics / tags

```
typescript  nodejs  react  express  mongodb  mongodb-atlas  vector-search
redis  bullmq  openai  rag  llm  ai  server-sent-events  job-queue
multi-tenant  rate-limiting  prompt-injection  jwt-authentication  ci-cd
full-stack  portfolio-project
```

> GitHub allows up to 20 topics; trim the list if needed (keep the first ~16).

## Long description (README intro / project page)

> **AI Operations Copilot** is a production-grade, multi-tenant web application
> that helps on-call engineers resolve incidents faster by grounding LLM output in
> their own data. It delivers three features — **ticket summarization**, **SOP /
> runbook search (RAG)**, and **root-cause analysis** — each returning cited,
> confidence-scored results with a human edit-before-save workflow.
>
> The focus is the engineering *around* the model. Generative work runs on an
> **asynchronous BullMQ/Redis job queue** and streams to the browser over
> **Server-Sent Events**, so 10–60-second LLM calls never block requests. Retrieval
> uses **MongoDB Atlas Vector Search** (document chunking + OpenAI embeddings, with
> a cosine fallback). Safety is layered: a **fail-closed PII redaction proxy**
> before every model call, **prompt-injection fencing** with per-request nonces,
> **multi-tenant isolation** across data, Redis keys, and job ownership,
> **HS256-pinned JWT auth** with **short-lived signed SSE tokens**, and
> **Redis-backed rate limiting and token budgeting** that stay correct across
> replicas.
>
> It ships with **GitHub Actions CI** that runs typecheck plus unit and integration
> tests against real `mongo:7` and `redis:7` services, **0 `npm audit`
> vulnerabilities**, and end-to-end documentation (architecture, API, schema,
> security, deployment) with Mermaid diagrams.
>
> Stack: React · Express · BullMQ/Redis · MongoDB Atlas · OpenAI · TypeScript (ESM).

## Suggested social preview / tagline

> **AI Operations Copilot** — grounded AI for incident response, built like
> production: async, multi-tenant, secure, and CI-tested against a real database.

## Repository settings recommendations

- **Visibility:** Public (portfolio). No secrets or artifacts are tracked.
- **License:** MIT.
- **Default branch:** `main` (PR #1 merges the feature branch).
- **Branch protection:** require the CI check to pass before merge.
- **Pin** this repo on your profile for the portfolio showcase.
- **Social preview image:** a screenshot of the Incident Workspace (the `AIBlock`
  with citations + confidence) reads well.

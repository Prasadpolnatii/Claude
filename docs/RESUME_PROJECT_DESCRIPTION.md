# Resume Project Description

Copy-paste blocks at different lengths. Swap the stack/impact words to match the
target role.

## 1-line version

> **AI Operations Copilot** — a multi-tenant, production-grade incident-response
> web app (React/Express/MongoDB Atlas/Redis/OpenAI) with grounded RAG, async
> SSE-streamed LLM jobs, fail-closed PII redaction, and 0 dependency
> vulnerabilities.

## 3-line version

> Built **AI Operations Copilot**, a multi-tenant SaaS that turns incident
> tickets, logs, and runbooks into cited, confidence-scored summaries, RAG
> answers, and root-cause analyses. Engineered an async **BullMQ/Redis job
> pipeline with SSE streaming**, **MongoDB Atlas Vector Search** RAG, and
> LLM-safety controls (fail-closed redaction, prompt-injection fencing,
> per-tenant rate limits + token budgets, signed short-lived stream tokens).
> Shipped with **CI integration tests against a real database** and a clean
> security audit (`npm audit`: 0 vulnerabilities).

## Detailed version

> **AI Operations Copilot** — TypeScript (React, Express, Node), MongoDB Atlas
> Vector Search, Redis/BullMQ, OpenAI.
>
> A multi-tenant web application that helps on-call engineers resolve incidents by
> grounding LLM output in their own data. Three features — ticket summarization,
> SOP/runbook search (RAG), and root-cause analysis — each return cited,
> confidence-scored results with a human edit-before-save workflow.
>
> Designed an **async-first architecture**: an Express API enqueues generative
> work to a BullMQ/Redis queue (`202 + jobId`) and a horizontally-scalable worker
> runs a **redact → retrieve → fence → LLM → schema-validate** pipeline, streaming
> tokens to the browser over **Server-Sent Events** with 60-second job-scoped
> tokens. Implemented **RAG** with document chunking, OpenAI embeddings, and
> **MongoDB Atlas Vector Search** (with a cosine fallback for non-Atlas).
>
> Hardened for production: **fail-closed PII redaction** before every model call,
> **prompt-injection defense** via per-call nonce fencing, **multi-tenant
> isolation** across data/queries/Redis keys, **HS256-pinned JWT auth**, **Redis
> rate limiting and token budgeting** shared across replicas, a **uniform error
> envelope**, and graceful degradation without MongoDB. Set up **GitHub Actions
> CI** running typecheck plus unit and integration tests against real `mongo:7`
> and `redis:7` services, and resolved a HIGH-severity transitive vulnerability
> (`npm audit`: 0).

## ATS-friendly bullet points

- Engineered a multi-tenant AI SaaS (React, Express, TypeScript, MongoDB Atlas,
  Redis, OpenAI) delivering grounded, citation-backed LLM features for incident
  response.
- Designed an asynchronous job pipeline using BullMQ and Redis with Server-Sent
  Events streaming, decoupling 10–60s LLM calls from HTTP requests and enabling
  horizontal worker scaling.
- Implemented Retrieval-Augmented Generation (RAG) with document chunking, OpenAI
  embeddings, and MongoDB Atlas Vector Search, including tenant-scoped vector
  filtering and a cosine-similarity fallback.
- Built LLM-safety controls: a fail-closed PII/secret redaction proxy enforced
  before every model call, prompt-injection fencing with per-request nonces, and
  schema validation of model output.
- Enforced multi-tenant data isolation across MongoDB queries, Redis keys, and job
  ownership; added compound unique indexes on tenant id.
- Added Redis-backed, cross-replica rate limiting (per-IP and per-tenant) and a
  per-tenant daily token budget meter with check-before-spend semantics.
- Implemented JWT authentication (HS256, algorithm-pinned) with short-lived,
  single-purpose signed tokens for SSE streams.
- Established GitHub Actions CI (typecheck, unit + integration tests against real
  MongoDB and Redis services, web build) and remediated a HIGH-severity transitive
  dependency vulnerability, achieving 0 npm audit findings.
- Documented the system end-to-end (architecture, API, schema, security,
  deployment) with Mermaid diagrams for portfolio and production handoff.

## Skills demonstrated

System design · async/distributed processing · RAG / vector search · LLM safety
& security · multi-tenancy · API design · TypeScript · MongoDB/Mongoose · Redis ·
CI/CD · technical writing.

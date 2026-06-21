import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { mongoState, warmConnectMongo } from "./db/mongo.js";
import { requireAuth } from "./auth/jwt.js";
import { requireMongo } from "./middleware/requireMongo.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { jobsRouter } from "./routes/jobs.js";
import { ticketsRouter } from "./routes/tickets.js";
import { sopsRouter } from "./routes/sops.js";
import { rcaRouter } from "./routes/rca.js";

/**
 * API entrypoint. Serves HTTP only; generative work runs in the worker
 * (`npm run worker`) — they share Redis + Mongo. Run both for the full flow.
 *
 * The server boots WITHOUT waiting on MongoDB. Health + job endpoints (Redis)
 * work immediately; ticket/SOP routes lazy-connect Mongo via `requireMongo` and
 * return 503 if it's down. This keeps mock-mode demos working with no database.
 */

function main() {
  const app = express();
  app.use(cors({ origin: config.WEB_ORIGIN }));
  app.use(express.json({ limit: "2mb" }));

  // Health reports the live Mongo state so callers can see degraded mode.
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, llmMode: config.LLM_MODE, mongo: mongoState() }),
  );

  // Everything below requires a tenant-scoped JWT.
  // Jobs are Redis-only — no Mongo dependency.
  app.use("/api/jobs", requireAuth, jobsRouter);
  // Tickets need Mongo — gated so they 503 cleanly when it's down.
  app.use("/api/tickets", requireAuth, requireMongo, ticketsRouter);
  // SOPs are Mongo-optional: Atlas Vector Search when up, Redis-backed store in
  // mock mode. No requireMongo gate so upload + search work without a database.
  app.use("/api/sops", requireAuth, sopsRouter);
  // RCA: generation is Mongo-optional (mock mode); persistence (POST/GET) gates
  // Mongo per-route inside the router.
  app.use("/api/rca", requireAuth, rcaRouter);

  app.use(notFound);
  app.use(errorHandler);

  app.listen(config.API_PORT, () => {
    console.log(`[api] listening on http://localhost:${config.API_PORT} (LLM_MODE=${config.LLM_MODE})`);
    console.log(`[api] remember to start the worker: npm run worker`);
  });

  // Best-effort warm connect — never blocks boot, never crashes.
  warmConnectMongo("boot");
}

main();

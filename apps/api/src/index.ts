import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { connectMongo } from "./db/mongo.js";
import { requireAuth } from "./auth/jwt.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { jobsRouter } from "./routes/jobs.js";
import { ticketsRouter } from "./routes/tickets.js";
import { sopsRouter } from "./routes/sops.js";

/**
 * API entrypoint. Note: this process serves HTTP only. The generative work runs
 * in the worker (`npm run worker`) — they share Redis + Mongo. Run both for the
 * full flow.
 */

async function main() {
  await connectMongo();

  const app = express();
  app.use(cors({ origin: config.WEB_ORIGIN }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true, llmMode: config.LLM_MODE }));

  // Everything below requires a tenant-scoped JWT.
  app.use("/api/jobs", requireAuth, jobsRouter);
  app.use("/api/tickets", requireAuth, ticketsRouter);
  app.use("/api/sops", requireAuth, sopsRouter);

  app.use(notFound);
  app.use(errorHandler);

  app.listen(config.API_PORT, () => {
    console.log(`[api] listening on http://localhost:${config.API_PORT} (LLM_MODE=${config.LLM_MODE})`);
    console.log(`[api] remember to start the worker: npm run worker`);
  });
}

main().catch((err) => {
  console.error("[api] fatal", err);
  process.exit(1);
});

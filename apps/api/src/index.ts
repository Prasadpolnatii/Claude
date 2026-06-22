import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { mongoState, warmConnectMongo } from "./db/mongo.js";
import { requireAuth, requireRole } from "./auth/jwt.js";
import { requireMongo } from "./middleware/requireMongo.js";
import { globalLimiter } from "./middleware/rateLimit.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { jobsRouter } from "./routes/jobs.js";
import { ticketsRouter } from "./routes/tickets.js";
import { sopsRouter } from "./routes/sops.js";
import { rcaRouter } from "./routes/rca.js";
import { incidentsRouter } from "./routes/incidents.js";
import { applicationsRouter } from "./routes/applications.js";
import { alertsRouter } from "./routes/alerts.js";
import { queuesRouter } from "./routes/queues.js";
import { knowledgeRouter } from "./routes/knowledge.js";
import { auditRouter } from "./routes/audit.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { reportsRouter } from "./routes/reports.js";
import { startAlertSimulator } from "./features/alertsBus.js";

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
  // Behind a proxy/load balancer, trust X-Forwarded-For so req.ip (used by the
  // rate limiter) reflects the real client. Loopback-only by default.
  app.set("trust proxy", "loopback");
  app.use(cors({ origin: config.WEB_ORIGIN }));
  app.use(express.json({ limit: "2mb" }));

  // Health reports the live Mongo state so callers can see degraded mode.
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, llmMode: config.LLM_MODE, mongo: mongoState() }),
  );

  // Global per-IP flood guard for the whole API (after health so monitors aren't
  // limited).
  app.use("/api", globalLimiter);

  // Jobs are Redis-only. Auth is applied per-route inside the router: header
  // bearer for submit/poll/stream-token, a short-lived stream token for the SSE
  // route (EventSource can't send headers).
  app.use("/api/jobs", jobsRouter);
  // Tickets need Mongo — gated so they 503 cleanly when it's down.
  app.use("/api/tickets", requireAuth, requireMongo, ticketsRouter);
  // SOPs are Mongo-optional: Atlas Vector Search when up, Redis-backed store in
  // mock mode. No requireMongo gate so upload + search work without a database.
  app.use("/api/sops", requireAuth, sopsRouter);
  // RCA: generation is Mongo-optional (mock mode); persistence (POST/GET) gates
  // Mongo per-route inside the router.
  app.use("/api/rca", requireAuth, rcaRouter);

  // ── Operations dashboard ───────────────────────────────────────────────────
  // All Mongo-backed read/write surfaces. Each is tenant-scoped via requireAuth.
  app.use("/api/dashboard", requireAuth, requireMongo, dashboardRouter);
  app.use("/api/incidents", requireAuth, requireMongo, incidentsRouter);
  app.use("/api/applications", requireAuth, requireMongo, applicationsRouter);
  app.use("/api/queues", requireAuth, requireMongo, queuesRouter);
  app.use("/api/knowledge", requireAuth, requireMongo, knowledgeRouter);
  app.use("/api/reports", requireAuth, requireMongo, reportsRouter);
  // Audit log is admin-only (RBAC).
  app.use("/api/audit", requireAuth, requireRole("admin"), requireMongo, auditRouter);
  // Alerts mix header-auth (list/resolve) with a short-lived stream token (SSE),
  // so auth is applied per-route inside the router — like jobs.
  app.use("/api/alerts", alertsRouter);

  app.use(notFound);
  app.use(errorHandler);

  app.listen(config.API_PORT, () => {
    console.log(`[api] listening on http://localhost:${config.API_PORT} (LLM_MODE=${config.LLM_MODE})`);
    console.log(`[api] remember to start the worker: npm run worker`);
  });

  // Best-effort warm connect — never blocks boot, never crashes.
  warmConnectMongo("boot");

  // Real-time alert producer for the demo tenant (no-op when disabled or when
  // Mongo is down). A real deployment wires a monitoring webhook to the bus.
  startAlertSimulator();
}

main();

import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import type { AlertStreamEvent } from "@ops-copilot/shared";
import { Alert as AlertModel } from "../models/index.js";
import { serializeAlert } from "../features/serialize.js";
import { subscribeAlerts } from "../features/alertsBus.js";
import { recordAudit } from "../features/audit.js";
import { requireAuth, requireAlertStreamToken, signAlertStreamToken } from "../auth/jwt.js";
import { requireMongo } from "../middleware/requireMongo.js";
import { asyncHandler, badRequest, notFoundError } from "../middleware/error.js";

export const alertsRouter = Router();

const notFound = () => notFoundError("Alert");

/**
 * GET /api/alerts — historical list.
 *   ?status=firing|resolved  ?severity=critical|warning|info  ?limit=N
 * Firing-first, then newest.
 */
alertsRouter.get(
  "/",
  requireAuth,
  requireMongo,
  asyncHandler(async (req: Request, res: Response) => {
    const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
    if (req.query.status === "firing" || req.query.status === "resolved") filter.status = req.query.status;
    if (["critical", "warning", "info"].includes(String(req.query.severity))) filter.severity = req.query.severity;
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

    const docs = await AlertModel.find(filter).sort({ status: 1, firedAt: -1 }).limit(limit);
    res.json({ alerts: docs.map(serializeAlert) });
  }),
);

/**
 * GET /api/alerts/stream-token — exchange the session JWT (header auth) for a
 * short-lived token usable in the EventSource URL.
 */
alertsRouter.get(
  "/stream-token",
  requireAuth,
  (req: Request, res: Response) => {
    res.json({ streamToken: signAlertStreamToken(req.auth!.tenantId) });
  },
);

/**
 * GET /api/alerts/stream?t=... — live alert feed over Server-Sent Events.
 * Streams the current firing alerts on connect, then pushes new alerts and
 * resolutions as they happen. Auth is the short-lived alert stream token.
 */
alertsRouter.get(
  "/stream",
  requireAlertStreamToken,
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: AlertStreamEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    // Backfill: current firing alerts so a fresh viewer isn't empty (best-effort).
    try {
      const { isMongoConnected } = await import("../db/mongo.js");
      if (isMongoConnected()) {
        const firing = await AlertModel.find({ tenantId, status: "firing" }).sort({ firedAt: -1 }).limit(50);
        for (const doc of firing) send({ type: "alert", alert: serializeAlert(doc) });
      }
    } catch {
      /* ignore backfill failures — live stream still works */
    }

    const unsubscribe = subscribeAlerts(tenantId, (ev) =>
      send(ev.kind === "resolved" ? { type: "resolved", alert: ev.alert } : { type: "alert", alert: ev.alert }),
    );

    // Heartbeat keeps proxies from closing an idle connection.
    const heartbeat = setInterval(() => send({ type: "heartbeat", at: new Date().toISOString() }), 25_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  }),
);

/** POST /api/alerts/:id/resolve — manually resolve a firing alert (audited). */
alertsRouter.post(
  "/:id/resolve",
  requireAuth,
  requireMongo,
  asyncHandler(async (req: Request, res: Response) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound();
    const { tenantId, userId, role } = req.auth!;
    const doc = await AlertModel.findOne({ _id: req.params.id, tenantId });
    if (!doc) throw notFound();
    if (doc.status === "resolved") throw badRequest("Alert is already resolved.");

    doc.status = "resolved";
    doc.resolvedAt = new Date();
    await doc.save();
    recordAudit({ tenantId, actor: userId, role, action: "alert.resolve", target: String(doc._id) });

    const { publishAlert } = await import("../features/alertsBus.js");
    publishAlert({ tenantId, kind: "resolved", alert: serializeAlert(doc) });
    res.json({ alert: serializeAlert(doc) });
  }),
);

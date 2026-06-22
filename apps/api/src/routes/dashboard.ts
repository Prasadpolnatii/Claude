import { Router, type Request, type Response } from "express";
import type { AlertSeverity, DashboardOverview, IncidentSeverity } from "@ops-copilot/shared";
import { Alert, Application, Incident, QueueStat } from "../models/index.js";
import { deriveHealth, deriveQueueStatus } from "../features/serialize.js";
import { asyncHandler } from "../middleware/error.js";

export const dashboardRouter = Router();

/**
 * GET /api/dashboard — roll-up counters for the landing page. One aggregated
 * read per collection so the overview is a single round trip for the client.
 */
dashboardRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;

    const [openIncidents, firingAlerts, apps, queues] = await Promise.all([
      Incident.find({ tenantId, status: { $ne: "resolved" } }, { severity: 1 }),
      Alert.find({ tenantId, status: "firing" }, { severity: 1 }),
      Application.find({ tenantId }, { errorRatePct: 1, latencyMsP95: 1 }),
      QueueStat.find({ tenantId }, { depth: 1, oldestAgeSec: 1 }),
    ]);

    const incidentBySeverity: Record<IncidentSeverity, number> = { sev1: 0, sev2: 0, sev3: 0, sev4: 0 };
    for (const i of openIncidents) incidentBySeverity[i.severity as IncidentSeverity]++;

    const alertBySeverity: Record<AlertSeverity, number> = { critical: 0, warning: 0, info: 0 };
    for (const a of firingAlerts) alertBySeverity[a.severity as AlertSeverity]++;

    const appCounts = { total: apps.length, healthy: 0, degraded: 0, down: 0 };
    for (const a of apps) appCounts[deriveHealth(a.errorRatePct ?? 0, a.latencyMsP95 ?? 0)]++;

    const queueCounts = { total: queues.length, warning: 0, critical: 0 };
    for (const q of queues) {
      const s = deriveQueueStatus(q.depth ?? 0, q.oldestAgeSec ?? 0);
      if (s === "warning") queueCounts.warning++;
      else if (s === "critical") queueCounts.critical++;
    }

    const overview: DashboardOverview = {
      incidents: { open: openIncidents.length, bySeverity: incidentBySeverity },
      alerts: { firing: firingAlerts.length, bySeverity: alertBySeverity },
      applications: appCounts,
      queues: queueCounts,
      updatedAt: new Date().toISOString(),
    };
    res.json({ overview });
  }),
);

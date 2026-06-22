import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import type { Alert as AlertType, IncidentDetail } from "@ops-copilot/shared";
import { Alert, Incident } from "../models/index.js";
import { serializeAlert, serializeIncidentDetail } from "../features/serialize.js";
import { asyncHandler, HttpError } from "../middleware/error.js";

export const reportsRouter = Router();

export interface IncidentReport {
  incident: IncidentDetail;
  relatedAlerts: AlertType[];
  generatedAt: string;
  /** Wall-clock from detection to resolution, when resolved. */
  durationMinutes: number | null;
}

/**
 * GET /api/reports/incident/:id — assembled incident report payload for the
 * client's printable / "Export to PDF" view. Bundles the incident, its timeline,
 * and alerts on the same service during the incident window.
 */
reportsRouter.get(
  "/incident/:id",
  asyncHandler(async (req: Request, res: Response) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw new HttpError(404, { code: "not_found", message: "Incident not found.", retryable: false });
    }
    const tenantId = req.auth!.tenantId;
    const doc = await Incident.findOne({ _id: req.params.id, tenantId });
    if (!doc) throw new HttpError(404, { code: "not_found", message: "Incident not found.", retryable: false });

    const incident = serializeIncidentDetail(doc);
    const windowEnd = doc.resolvedAt ?? new Date();
    const related = await Alert.find({
      tenantId,
      service: incident.service,
      firedAt: { $gte: doc.startedAt, $lte: windowEnd },
    })
      .sort({ firedAt: 1 })
      .limit(100);

    const durationMinutes = doc.resolvedAt
      ? Math.max(0, Math.round((doc.resolvedAt.getTime() - new Date(doc.startedAt).getTime()) / 60000))
      : null;

    const report: IncidentReport = {
      incident,
      relatedAlerts: related.map(serializeAlert),
      generatedAt: new Date().toISOString(),
      durationMinutes,
    };
    res.json({ report });
  }),
);

import { Router, type Request, type Response } from "express";
import { AuditLog } from "../models/index.js";
import { serializeAudit } from "../features/serialize.js";
import { asyncHandler } from "../middleware/error.js";

export const auditRouter = Router();

/**
 * GET /api/audit — the operational audit trail (admin only; the role gate is
 * applied where this router is mounted). Newest first.
 *   ?action=incident.resolve  ?limit=N
 */
auditRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
    if (typeof req.query.action === "string" && req.query.action.trim()) {
      filter.action = req.query.action.trim();
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    const docs = await AuditLog.find(filter).sort({ at: -1 }).limit(limit);
    res.json({ entries: docs.map(serializeAudit) });
  }),
);

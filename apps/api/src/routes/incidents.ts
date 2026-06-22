import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES } from "@ops-copilot/shared";
import { Incident } from "../models/index.js";
import { serializeIncidentDetail, serializeIncidentRow } from "../features/serialize.js";
import { recordAudit } from "../features/audit.js";
import { asyncHandler, badRequest, HttpError } from "../middleware/error.js";

export const incidentsRouter = Router();

const SEVERITY_ORDER: Record<string, number> = { sev1: 0, sev2: 1, sev3: 2, sev4: 3 };

const notFound = () => new HttpError(404, { code: "not_found", message: "Incident not found.", retryable: false });

/** Parse a repeated/CSV query param into a validated subset of `allowed`. */
function multi(raw: unknown, allowed: readonly string[]): string[] | undefined {
  if (raw == null) return undefined;
  const values = (Array.isArray(raw) ? raw : String(raw).split(","))
    .map((v) => String(v).trim())
    .filter((v) => allowed.includes(v));
  return values.length ? values : undefined;
}

/**
 * GET /api/incidents — list, filterable by severity/status/service.
 *   ?severity=sev1,sev2  ?status=open,acknowledged  ?service=checkout-api
 * Sorted most-urgent-first (severity asc), then newest.
 */
incidentsRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
    const severity = multi(req.query.severity, INCIDENT_SEVERITIES);
    const status = multi(req.query.status, INCIDENT_STATUSES);
    if (severity) filter.severity = { $in: severity };
    if (status) filter.status = { $in: status };
    if (typeof req.query.service === "string" && req.query.service.trim()) {
      filter.service = req.query.service.trim();
    }

    const docs = await Incident.find(filter).sort({ startedAt: -1 }).limit(500);
    const rows = docs
      .map(serializeIncidentRow)
      .sort((a, b) => (SEVERITY_ORDER[a.severity]! - SEVERITY_ORDER[b.severity]!) || (a.startedAt < b.startedAt ? 1 : -1));
    res.json({ incidents: rows });
  }),
);

/** GET /api/incidents/:id — full detail with timeline. */
incidentsRouter.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound();
    const doc = await Incident.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId });
    if (!doc) throw notFound();
    res.json({ incident: serializeIncidentDetail(doc) });
  }),
);

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  service: z.string().trim().min(1).max(100),
  severity: z.enum(["sev1", "sev2", "sev3", "sev4"]),
  summary: z.string().trim().max(4000).optional(),
  logSnippet: z.string().trim().max(8000).optional(),
});

/** POST /api/incidents — declare a new incident. */
incidentsRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => i.message).join("; "));
    const { tenantId, userId, role } = req.auth!;

    const now = new Date();
    const doc = await Incident.create({
      tenantId,
      ...parsed.data,
      status: "open",
      startedAt: now,
      timeline: [{ at: now, kind: "detected", message: `Incident declared (${parsed.data.severity.toUpperCase()})`, actor: userId }],
    });
    recordAudit({ tenantId, actor: userId, role, action: "incident.create", target: String(doc._id), meta: { severity: parsed.data.severity, service: parsed.data.service } });
    res.status(201).json({ incident: serializeIncidentDetail(doc) });
  }),
);

/** POST /api/incidents/:id/ack — acknowledge (open → acknowledged). */
incidentsRouter.post(
  "/:id/ack",
  asyncHandler(async (req: Request, res: Response) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound();
    const { tenantId, userId, role } = req.auth!;
    const doc = await Incident.findOne({ _id: req.params.id, tenantId });
    if (!doc) throw notFound();
    if (doc.status === "resolved") throw badRequest("Incident is already resolved.");

    doc.status = "acknowledged";
    doc.acknowledgedBy = userId;
    doc.timeline.push({ at: new Date(), kind: "ack", message: `Acknowledged by ${userId}`, actor: userId });
    await doc.save();
    recordAudit({ tenantId, actor: userId, role, action: "incident.ack", target: String(doc._id) });
    res.json({ incident: serializeIncidentDetail(doc) });
  }),
);

/** POST /api/incidents/:id/resolve — resolve and stamp resolvedAt. */
incidentsRouter.post(
  "/:id/resolve",
  asyncHandler(async (req: Request, res: Response) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound();
    const { tenantId, userId, role } = req.auth!;
    const doc = await Incident.findOne({ _id: req.params.id, tenantId });
    if (!doc) throw notFound();

    const now = new Date();
    doc.status = "resolved";
    doc.resolvedAt = now;
    doc.timeline.push({ at: now, kind: "resolved", message: `Resolved by ${userId}`, actor: userId });
    await doc.save();
    recordAudit({ tenantId, actor: userId, role, action: "incident.resolve", target: String(doc._id) });
    res.json({ incident: serializeIncidentDetail(doc) });
  }),
);

const noteSchema = z.object({ message: z.string().trim().min(1).max(2000) });

/** POST /api/incidents/:id/note — append a free-text timeline note. */
incidentsRouter.post(
  "/:id/note",
  asyncHandler(async (req: Request, res: Response) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound();
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => i.message).join("; "));
    const { tenantId, userId } = req.auth!;
    const doc = await Incident.findOne({ _id: req.params.id, tenantId });
    if (!doc) throw notFound();

    doc.timeline.push({ at: new Date(), kind: "note", message: parsed.data.message, actor: userId });
    await doc.save();
    res.json({ incident: serializeIncidentDetail(doc) });
  }),
);

const severitySchema = z.object({ severity: z.enum(["sev1", "sev2", "sev3", "sev4"]) });

/** PATCH /api/incidents/:id/severity — re-grade severity (logged on the timeline). */
incidentsRouter.patch(
  "/:id/severity",
  asyncHandler(async (req: Request, res: Response) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound();
    const parsed = severitySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => i.message).join("; "));
    const { tenantId, userId, role } = req.auth!;
    const doc = await Incident.findOne({ _id: req.params.id, tenantId });
    if (!doc) throw notFound();

    const from = doc.severity;
    doc.severity = parsed.data.severity;
    doc.timeline.push({
      at: new Date(),
      kind: "status_change",
      message: `Severity changed ${String(from).toUpperCase()} → ${parsed.data.severity.toUpperCase()}`,
      actor: userId,
    });
    await doc.save();
    recordAudit({ tenantId, actor: userId, role, action: "incident.severity", target: String(doc._id), meta: { from, to: parsed.data.severity } });
    res.json({ incident: serializeIncidentDetail(doc) });
  }),
);

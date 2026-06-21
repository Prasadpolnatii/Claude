import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import type { JobType } from "@ops-copilot/shared";
import { Summary, Ticket } from "../models/index.js";
import { generativeQueue } from "../queue/queue.js";
import { ticketSummaryInputSchema } from "../features/summary.js";
import { asyncHandler, badRequest } from "../middleware/error.js";

export const ticketsRouter = Router();

/** GET /api/tickets — tenant-scoped inbox. */
ticketsRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const tickets = await Ticket.find({ tenantId: req.auth!.tenantId }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ tickets });
}));

const createSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  externalId: z.string().optional(),
});

/** POST /api/tickets — ingest a ticket. */
ticketsRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  const ticket = await Ticket.create({ ...parsed.data, tenantId: req.auth!.tenantId });
  res.status(201).json({ ticket });
}));

/**
 * POST /api/tickets/:id/summarize — the production entry point for Ticket
 * Summarization. Loads the stored ticket (tenant-scoped) and enqueues a summary
 * job, returning 202 + jobId. The client then streams the result via
 * GET /api/jobs/:id/stream. Pass an `Idempotency-Key` to dedupe double-clicks.
 */
ticketsRouter.post("/:id/summarize", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) throw badRequest("invalid ticket id");

  const tenantId = req.auth!.tenantId;
  const ticket = await Ticket.findOne({ _id: id, tenantId }).lean();
  if (!ticket) {
    res.status(404).json({ error: { code: "not_found", message: "Ticket not found.", retryable: false } });
    return;
  }

  const idempotencyKey = req.header("idempotency-key");
  const jobId = idempotencyKey
    ? `idem_${tenantId}_summ_${String(id)}_${idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "_")}`
    : undefined;

  const job = await generativeQueue.add(
    "ticket_summary",
    { tenantId, type: "ticket_summary" as JobType, input: { ticketText: ticket.body, ticketId: String(id) } },
    { jobId, removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 }, attempts: 2, backoff: { type: "exponential", delay: 2000 } },
  );

  res.status(202).json({ jobId: job.id, ticketId: String(id) });
}));

/** GET /api/tickets/:id/summary — fetch the saved (possibly human-edited) summary. */
ticketsRouter.get("/:id/summary", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) throw badRequest("invalid ticket id");
  const summary = await Summary.findOne({ tenantId: req.auth!.tenantId, ticketId: id }).lean();
  res.json({ summary: summary ?? null });
}));

/**
 * PUT /api/tickets/:id/summary — persist the summary after the human reviewed
 * (and possibly edited) the AI draft. Upserts one current summary per ticket.
 * `editedByHuman` records whether it was revised — the human-in-the-loop audit.
 */
ticketsRouter.put("/:id/summary", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) throw badRequest("invalid ticket id");

  const parsed = ticketSummaryInputSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));

  const tenantId = req.auth!.tenantId;
  // Tenant-scoped existence check so we never create a summary for another
  // tenant's (or a nonexistent) ticket.
  const ticket = await Ticket.findOne({ _id: id, tenantId }).select("_id").lean();
  if (!ticket) {
    res.status(404).json({ error: { code: "not_found", message: "Ticket not found.", retryable: false } });
    return;
  }

  const { headline, summary, impact, nextActions, editedByHuman, jobId } = parsed.data;
  const saved = await Summary.findOneAndUpdate(
    { tenantId, ticketId: id },
    { $set: { headline, summary, impact, nextActions, editedByHuman, jobId } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  res.status(200).json({ summary: saved });
}));

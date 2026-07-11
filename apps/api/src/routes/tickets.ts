import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import type { JobType } from "@ops-copilot/shared";
import { Summary, Ticket } from "../models/index.js";
import { generativeQueue, jobOptions, safeId } from "../queue/queue.js";
import { ticketSummaryInputSchema } from "../features/summary.js";
import { generativeLimiter } from "../middleware/rateLimit.js";
import { asyncHandler, notFoundError, parseOrThrow } from "../middleware/error.js";

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
  const data = parseOrThrow(createSchema, req.body);
  const ticket = await Ticket.create({ ...data, tenantId: req.auth!.tenantId });
  res.status(201).json({ ticket });
}));

/**
 * POST /api/tickets/:id/summarize — the production entry point for Ticket
 * Summarization. Loads the stored ticket (tenant-scoped) and enqueues a summary
 * job, returning 202 + jobId. The client then streams the result via
 * GET /api/jobs/:id/stream. Pass an `Idempotency-Key` to dedupe double-clicks.
 */
ticketsRouter.post("/:id/summarize", generativeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) throw notFoundError("Ticket");

  const tenantId = req.auth!.tenantId;
  const ticket = await Ticket.findOne({ _id: id, tenantId }).lean();
  if (!ticket) throw notFoundError("Ticket");

  const idempotencyKey = req.header("idempotency-key");
  const jobId = idempotencyKey
    ? `idem_${tenantId}_summ_${String(id)}_${safeId(idempotencyKey)}`
    : undefined;

  const job = await generativeQueue.add(
    "ticket_summary",
    { tenantId, type: "ticket_summary" as JobType, input: { ticketText: ticket.body, ticketId: String(id) } },
    jobOptions(jobId),
  );

  res.status(202).json({ jobId: job.id, ticketId: String(id) });
}));

/** GET /api/tickets/:id/summary — fetch the saved (possibly human-edited) summary. */
ticketsRouter.get("/:id/summary", asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) throw notFoundError("Ticket");
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
  if (!mongoose.isValidObjectId(id)) throw notFoundError("Ticket");

  const data = parseOrThrow(ticketSummaryInputSchema, req.body);

  const tenantId = req.auth!.tenantId;
  // Tenant-scoped existence check so we never create a summary for another
  // tenant's (or a nonexistent) ticket.
  const ticket = await Ticket.findOne({ _id: id, tenantId }).select("_id").lean();
  if (!ticket) throw notFoundError("Ticket");

  const { headline, summary, impact, nextActions, editedByHuman, jobId } = data;
  const saved = await Summary.findOneAndUpdate(
    { tenantId, ticketId: id },
    { $set: { headline, summary, impact, nextActions, editedByHuman, jobId } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  res.status(200).json({ summary: saved });
}));

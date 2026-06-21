import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import type { JobType } from "@ops-copilot/shared";
import { Rca } from "../models/index.js";
import { generativeQueue } from "../queue/queue.js";
import { rcaGenerateSchema, rcaSaveInputSchema } from "../features/rca.js";
import { requireMongo } from "../middleware/requireMongo.js";
import { generativeLimiter } from "../middleware/rateLimit.js";
import { asyncHandler, badRequest } from "../middleware/error.js";

export const rcaRouter = Router();

/**
 * POST /api/rca/generate — start grounded RCA generation. Accepts an incident
 * summary + optional log snippet, enqueues an `rca` job (which retrieves SOP
 * chunks, redacts, and generates a cited RCA), and returns a jobId. Mongo-
 * optional: works in mock mode (SOP retrieval falls back to the Redis store).
 * The client streams the result via GET /api/jobs/:id/stream.
 */
rcaRouter.post("/generate", generativeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const parsed = rcaGenerateSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => i.message).join("; "));

  const tenantId = req.auth!.tenantId;
  const idempotencyKey = req.header("idempotency-key");
  const jobId = idempotencyKey
    ? `idem_${tenantId}_rca_${idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "_")}`
    : undefined;

  const job = await generativeQueue.add(
    "rca",
    {
      tenantId,
      type: "rca" as JobType,
      input: {
        incidentSummary: parsed.data.incidentSummary,
        logSnippet: parsed.data.logSnippet,
        incidentId: parsed.data.incidentId,
      },
    },
    { jobId, removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 }, attempts: 2, backoff: { type: "exponential", delay: 2000 } },
  );

  res.status(202).json({ jobId: job.id });
}));

/**
 * POST /api/rca — persist a reviewed (possibly human-edited) RCA. Needs Mongo.
 * Upserts one current RCA per incidentId when provided, else inserts a new one.
 */
rcaRouter.post("/", requireMongo, asyncHandler(async (req: Request, res: Response) => {
  const parsed = rcaSaveInputSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));

  const tenantId = req.auth!.tenantId;
  const { incidentId, ...doc } = parsed.data;

  let saved;
  if (incidentId) {
    saved = await Rca.findOneAndUpdate(
      { tenantId, incidentId },
      { $set: { ...doc, incidentId } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();
  } else {
    saved = (await Rca.create({ ...doc, tenantId })).toObject();
  }
  res.status(200).json({ rca: saved });
}));

/** GET /api/rca/:id — fetch a saved RCA. Needs Mongo. */
rcaRouter.get("/:id", requireMongo, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) throw badRequest("invalid rca id");
  const rca = await Rca.findOne({ _id: id, tenantId: req.auth!.tenantId }).lean();
  if (!rca) {
    res.status(404).json({ error: { code: "not_found", message: "RCA not found.", retryable: false } });
    return;
  }
  res.json({ rca });
}));

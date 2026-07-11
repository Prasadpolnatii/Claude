import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import type { JobType } from "@ops-copilot/shared";
import { Rca } from "../models/index.js";
import { generativeQueue, jobOptions, safeId } from "../queue/queue.js";
import { rcaGenerateSchema, rcaSaveInputSchema } from "../features/rca.js";
import { requireMongo } from "../middleware/requireMongo.js";
import { generativeLimiter } from "../middleware/rateLimit.js";
import { asyncHandler, notFoundError, parseOrThrow } from "../middleware/error.js";

export const rcaRouter = Router();

/**
 * POST /api/rca/generate — start grounded RCA generation. Accepts an incident
 * summary + optional log snippet, enqueues an `rca` job (which retrieves SOP
 * chunks, redacts, and generates a cited RCA), and returns a jobId. Mongo-
 * optional: works in mock mode (SOP retrieval falls back to the Redis store).
 * The client streams the result via GET /api/jobs/:id/stream.
 */
rcaRouter.post("/generate", generativeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const data = parseOrThrow(rcaGenerateSchema, req.body);

  const tenantId = req.auth!.tenantId;
  const idempotencyKey = req.header("idempotency-key");
  const jobId = idempotencyKey
    ? `idem_${tenantId}_rca_${safeId(idempotencyKey)}`
    : undefined;

  const job = await generativeQueue.add(
    "rca",
    {
      tenantId,
      type: "rca" as JobType,
      input: {
        incidentSummary: data.incidentSummary,
        logSnippet: data.logSnippet,
        incidentId: data.incidentId,
      },
    },
    jobOptions(jobId),
  );

  res.status(202).json({ jobId: job.id });
}));

/**
 * POST /api/rca — persist a reviewed (possibly human-edited) RCA. Needs Mongo.
 * Upserts one current RCA per incidentId when provided, else inserts a new one.
 */
rcaRouter.post("/", requireMongo, asyncHandler(async (req: Request, res: Response) => {
  const data = parseOrThrow(rcaSaveInputSchema, req.body);

  const tenantId = req.auth!.tenantId;
  const { incidentId, ...doc } = data;

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
  if (!mongoose.isValidObjectId(id)) throw notFoundError("RCA");
  const rca = await Rca.findOne({ _id: id, tenantId: req.auth!.tenantId }).lean();
  if (!rca) throw notFoundError("RCA");
  res.json({ rca });
}));

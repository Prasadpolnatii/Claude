import { Router, type Request, type Response } from "express";
import type { QueueStat } from "@ops-copilot/shared";
import { QueueStat as QueueStatModel } from "../models/index.js";
import { serializeQueue, deriveQueueStatus } from "../features/serialize.js";
import { generativeQueue, JOB_QUEUE } from "../queue/queue.js";
import { asyncHandler } from "../middleware/error.js";

export const queuesRouter = Router();

/**
 * GET /api/queues — work-queue depth/throughput monitoring.
 *
 * Combines two sources: seeded synthetic queues (for a populated demo) and the
 * LIVE BullMQ generative queue, whose depth is read straight from Redis via
 * `getJobCounts`. The live row reflects real in-flight AI jobs.
 */
queuesRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const docs = await QueueStatModel.find({ tenantId: req.auth!.tenantId }).sort({ name: 1 });
    const queues: QueueStat[] = docs.map(serializeQueue);

    // Live BullMQ counts — best-effort; never fail the endpoint on a Redis blip.
    try {
      const counts = await generativeQueue.getJobCounts("waiting", "active", "delayed", "failed");
      const depth = (counts.waiting ?? 0) + (counts.delayed ?? 0);
      const inFlight = counts.active ?? 0;
      queues.unshift({
        id: `live:${JOB_QUEUE}`,
        name: `${JOB_QUEUE} (live)`,
        depth,
        inFlight,
        ratePerMin: 0,
        oldestAgeSec: 0,
        consumers: inFlight > 0 ? 1 : 0,
        status: deriveQueueStatus(depth, 0),
        updatedAt: new Date().toISOString(),
      });
    } catch {
      /* Redis unavailable — return the persisted snapshots only. */
    }

    res.json({ queues });
  }),
);

import { Queue, QueueEvents, type ConnectionOptions, type JobsOptions } from "bullmq";
import IORedis from "ioredis";
import type { JobType } from "@ops-copilot/shared";
import { config } from "../config.js";

/**
 * Async job queue (Eng-review High: generative calls take 10–60s and must never
 * run inside an Express handler). Routes enqueue here and return 202 + jobId;
 * the worker processes and the SSE endpoint streams progress.
 */

// We own the ioredis instance (for an explicit disconnect on shutdown). BullMQ
// bundles its own ioredis copy, so its ConnectionOptions type is a distinct
// nominal type from ours — `sharedConnection` casts at that boundary. Runtime is
// identical; this is the documented dual-package type hazard, not a real mismatch.
export const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
/** The same connection, typed for BullMQ's bundled-ioredis ConnectionOptions. */
export const sharedConnection = connection as unknown as ConnectionOptions;

export const JOB_QUEUE = "generative";

export interface JobPayload {
  tenantId: string;
  type: JobType;
  input: Record<string, unknown>;
}

export const generativeQueue = new Queue<JobPayload>(JOB_QUEUE, { connection: sharedConnection });

/** BullMQ custom job ids may not contain ":". Keep them id-safe. */
export const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

/** Shared enqueue options: optional idempotency id, auto-clean, and retry with backoff. */
export const jobOptions = (jobId?: string): JobsOptions => ({
  jobId,
  removeOnComplete: { age: 3600 },
  removeOnFail: { age: 86400 },
  attempts: 2,
  backoff: { type: "exponential", delay: 2000 },
});

/** Shared events bus so the SSE route can subscribe to job progress. */
export const queueEvents = new QueueEvents(JOB_QUEUE, { connection: sharedConnection });
// Each open SSE stream adds 3 listeners (progress/completed/failed) and removes
// them on close. Lift the default cap so many concurrent streams don't trip the
// MaxListenersExceededWarning. (Listeners are still cleaned up per connection.)
queueEvents.setMaxListeners(0);

export async function closeQueue(): Promise<void> {
  await generativeQueue.close();
  await queueEvents.close();
  connection.disconnect();
}

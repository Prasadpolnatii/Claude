import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import type { JobType } from "@ops-copilot/shared";
import { config } from "../config.js";

/**
 * Async job queue (Eng-review High: generative calls take 10–60s and must never
 * run inside an Express handler). Routes enqueue here and return 202 + jobId;
 * the worker processes and the SSE endpoint streams progress.
 */

export const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

export const JOB_QUEUE = "generative";

export interface JobPayload {
  tenantId: string;
  type: JobType;
  input: Record<string, unknown>;
}

export const generativeQueue = new Queue<JobPayload>(JOB_QUEUE, { connection });

/** Shared events bus so the SSE route can subscribe to job progress. */
export const queueEvents = new QueueEvents(JOB_QUEUE, { connection });

export async function closeQueue(): Promise<void> {
  await generativeQueue.close();
  await queueEvents.close();
  connection.disconnect();
}

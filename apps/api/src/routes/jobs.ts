import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Job, JobStreamEvent, JobType } from "@ops-copilot/shared";
import { generativeQueue, queueEvents } from "../queue/queue.js";
import { badRequest } from "../middleware/error.js";

export const jobsRouter = Router();

const submitSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ticket_summary"), input: z.object({ ticketText: z.string().min(1) }) }),
  z.object({ type: z.literal("sop_search"), input: z.object({ query: z.string().min(1) }) }),
  z.object({
    type: z.literal("rca"),
    input: z.object({ incidentSummary: z.string().min(1), logSnippet: z.string().default("") }),
  }),
]);

/**
 * POST /api/jobs — enqueue a generative job. Returns 202 + jobId (async contract).
 * Supports `Idempotency-Key` so a double-click doesn't burn two LLM calls.
 */
jobsRouter.post("/", async (req: Request, res: Response) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => i.message).join("; "));

  const tenantId = req.auth!.tenantId;
  const idempotencyKey = req.header("idempotency-key");
  const jobId = idempotencyKey ? `${tenantId}:${idempotencyKey}` : undefined;

  if (jobId) {
    const existing = await generativeQueue.getJob(jobId);
    if (existing) {
      res.status(202).json({ jobId: existing.id, deduped: true });
      return;
    }
  }

  const job = await generativeQueue.add(
    parsed.data.type,
    { tenantId, type: parsed.data.type as JobType, input: parsed.data.input },
    { jobId, removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 }, attempts: 2, backoff: { type: "exponential", delay: 2000 } },
  );

  res.status(202).json({ jobId: job.id });
});

/** GET /api/jobs/:id — poll status/result. */
jobsRouter.get("/:id", async (req: Request, res: Response) => {
  const job = await loadOwnedJob(req, res);
  if (!job) return;
  res.json(await toClientJob(job, req.auth!.tenantId));
});

/**
 * GET /api/jobs/:id/stream — SSE. Streams token deltas as the worker produces
 * them, then a final `done` event. The browser renders this as live output.
 */
jobsRouter.get("/:id/stream", async (req: Request, res: Response) => {
  const job = await loadOwnedJob(req, res);
  if (!job) return;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (e: JobStreamEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);

  const onProgress = ({ jobId, data }: { jobId: string; data: unknown }) => {
    if (jobId !== job.id) return;
    const token = (data as { token?: string })?.token;
    if (token) send({ type: "token", text: token });
  };
  const onCompleted = async ({ jobId }: { jobId: string }) => {
    if (jobId !== job.id) return;
    const fresh = await generativeQueue.getJob(job.id!);
    if (fresh) send({ type: "done", job: await toClientJob(fresh, req.auth!.tenantId) });
    cleanup();
    res.end();
  };
  const onFailed = ({ jobId, failedReason }: { jobId: string; failedReason: string }) => {
    if (jobId !== job.id) return;
    send({ type: "error", error: { code: "internal", message: failedReason, retryable: true } });
    cleanup();
    res.end();
  };

  queueEvents.on("progress", onProgress);
  queueEvents.on("completed", onCompleted);
  queueEvents.on("failed", onFailed);
  send({ type: "status", status: "running" });

  function cleanup() {
    queueEvents.off("progress", onProgress);
    queueEvents.off("completed", onCompleted);
    queueEvents.off("failed", onFailed);
  }
  req.on("close", cleanup);
});

async function loadOwnedJob(req: Request, res: Response) {
  const job = await generativeQueue.getJob(req.params.id!);
  // Tenant isolation: a job id from another tenant must look like a 404.
  if (!job || job.data.tenantId !== req.auth!.tenantId) {
    res.status(404).json({ error: { code: "not_found", message: "Job not found.", retryable: false } });
    return null;
  }
  return job;
}

async function toClientJob(job: Awaited<ReturnType<typeof generativeQueue.getJob>>, tenantId: string): Promise<Job> {
  const state = await job!.getState();
  const status =
    state === "completed" ? "succeeded" : state === "failed" ? "failed" : state === "active" ? "running" : "queued";
  return {
    id: job!.id!,
    tenantId,
    type: job!.name as JobType,
    status,
    createdAt: new Date(job!.timestamp).toISOString(),
    updatedAt: new Date(job!.processedOn ?? job!.timestamp).toISOString(),
    result: job!.returnvalue ?? undefined,
    error: job!.failedReason
      ? { code: "internal", message: job!.failedReason, retryable: true }
      : undefined,
  };
}

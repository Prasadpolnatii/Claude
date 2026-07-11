import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { ApiError, Job, JobStreamEvent, JobType } from "@ops-copilot/shared";
import { generativeQueue, jobOptions, queueEvents, safeId } from "../queue/queue.js";
import { requireAuth, requireStreamToken, signStreamToken } from "../auth/jwt.js";
import { generativeLimiter } from "../middleware/rateLimit.js";
import { asyncHandler, parseOrThrow } from "../middleware/error.js";

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
jobsRouter.post("/", requireAuth, generativeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const data = parseOrThrow(submitSchema, req.body);

  const tenantId = req.auth!.tenantId;
  const idempotencyKey = req.header("idempotency-key");
  const jobId = idempotencyKey ? `idem_${safeId(tenantId)}_${safeId(idempotencyKey)}` : undefined;

  if (jobId) {
    const existing = await generativeQueue.getJob(jobId);
    if (existing) {
      res.status(202).json({ jobId: existing.id, deduped: true });
      return;
    }
  }

  const job = await generativeQueue.add(
    data.type,
    { tenantId, type: data.type as JobType, input: data.input },
    jobOptions(jobId),
  );

  res.status(202).json({ jobId: job.id });
}));

/** GET /api/jobs/:id — poll status/result. */
jobsRouter.get("/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const job = await loadOwnedJob(req, res);
  if (!job) return;
  res.json(await toClientJob(job, req.auth!.tenantId));
}));

/**
 * GET /api/jobs/:id/stream-token — mint a short-lived (60s), job-scoped token so
 * EventSource (which can't send headers) can authenticate the stream without
 * putting the session JWT in a URL.
 */
jobsRouter.get("/:id/stream-token", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const job = await loadOwnedJob(req, res);
  if (!job) return;
  res.json({ streamToken: signStreamToken(req.auth!.tenantId, req.params.id!), expiresIn: 60 });
}));

/**
 * GET /api/jobs/:id/stream — SSE. Streams token deltas as the worker produces
 * them, then a final `done` event. The browser renders this as live output.
 */
jobsRouter.get("/:id/stream", requireStreamToken, asyncHandler(async (req: Request, res: Response) => {
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

  function cleanup() {
    queueEvents.off("progress", onProgress);
    queueEvents.off("completed", onCompleted);
    queueEvents.off("failed", onFailed);
  }
  req.on("close", cleanup);

  // Completion race: a fast job may already be finished before the client
  // subscribed, so the completed/failed event never replays. Check current
  // state up front and emit the terminal event immediately if so.
  const state = await job.getState();
  if (state === "completed" || state === "failed") {
    const fresh = await generativeQueue.getJob(job.id!);
    if (fresh) {
      const clientJob = await toClientJob(fresh, req.auth!.tenantId);
      send(clientJob.error ? { type: "error", error: clientJob.error } : { type: "done", job: clientJob });
    }
    cleanup();
    res.end();
    return;
  }
  send({ type: "status", status: "running" });
}));

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
    error: job!.failedReason ? decodeJobError(job!.failedReason) : undefined,
  };
}

/**
 * The worker JSON-encodes a classified ApiError into the failure message so the
 * real `code` + `retryable` survive BullMQ (which only persists a string).
 * Recover it; fall back to a generic internal error for anything else.
 */
function decodeJobError(failedReason: string): ApiError {
  try {
    const parsed = JSON.parse(failedReason) as Partial<ApiError>;
    if (parsed && typeof parsed.code === "string" && typeof parsed.retryable === "boolean") {
      return { code: parsed.code, message: parsed.message ?? "Job failed.", retryable: parsed.retryable };
    }
  } catch {
    /* not our envelope */
  }
  return { code: "internal", message: failedReason, retryable: true };
}

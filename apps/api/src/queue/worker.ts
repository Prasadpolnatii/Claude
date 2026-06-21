import { Worker } from "bullmq";
import type { ApiError, JobResultMap } from "@ops-copilot/shared";
import { config } from "../config.js";
import { sharedConnection, JOB_QUEUE, type JobPayload } from "./queue.js";
import { warmConnectMongo } from "../db/mongo.js";
import {
  answerFromSops,
  generateRca,
  summarizeTicket,
  LlmError,
  DbUnavailableError,
} from "../llm/orchestrator.js";
import { RedactionError } from "../llm/redaction.js";
import { isOverBudget } from "../features/audit.js";

/**
 * The worker. Runs the orchestrator for each job type and publishes streamed
 * tokens to the queue events bus (the SSE route relays them to the browser).
 *
 * Run with: `npm run worker`. Scale horizontally by running N copies.
 *
 * Boots WITHOUT blocking on Mongo. `ticket_summary` needs no DB and runs in pure
 * mock mode; `sop_search`/`rca` lazy-connect Mongo and fail with a clean
 * `db_unavailable` if it's down.
 */

warmConnectMongo("worker boot");

const worker = new Worker<JobPayload>(
  JOB_QUEUE,
  async (job) => {
    const { tenantId, type, input } = job.data;

    if (isOverBudget(tenantId)) {
      throw toApiError("budget_exceeded", "Daily token budget exhausted for this tenant.", false);
    }

    const ctx = {
      tenantId,
      jobId: job.id ?? "unknown",
      // Fire-and-forget progress; swallow rejections so a transient Redis blip
      // on a token update doesn't become an unhandled rejection.
      onToken: (t: string) => void job.updateProgress({ token: t }).catch(() => {}),
    };

    let result: JobResultMap[typeof type];
    switch (type) {
      case "ticket_summary":
        result = await summarizeTicket(ctx, String(input.ticketText ?? ""));
        break;
      case "sop_search":
        result = await answerFromSops(ctx, String(input.query ?? ""));
        break;
      case "rca":
        result = await generateRca(
          ctx,
          String(input.incidentSummary ?? ""),
          String(input.logSnippet ?? ""),
        );
        break;
      default:
        throw toApiError("bad_request", `unknown job type: ${type}`, false);
    }

    return result;
  },
  { connection: sharedConnection, concurrency: 4 },
);

worker.on("failed", (job, err) => {
  // Map known failure classes to the uniform envelope so the UI can decide
  // retryable vs. not.
  const apiErr = classify(err);
  console.error(`[worker] job ${job?.id} failed: ${apiErr.code} — ${apiErr.message}`);
});

worker.on("completed", (job) => console.log(`[worker] job ${job.id} completed`));

function classify(err: unknown): ApiError {
  if (isApiError(err)) return err;
  if (err instanceof RedactionError) {
    // FAIL CLOSED: redaction failure means we never sent the prompt. Not retryable
    // without code/config fix.
    return toApiError("redaction_failed", "Redaction failed; LLM call aborted to prevent PII leak.", false);
  }
  if (err instanceof DbUnavailableError) {
    return toApiError("db_unavailable", "This feature needs MongoDB, which is unavailable.", true);
  }
  if (err instanceof LlmError) {
    return toApiError("llm_unavailable", "The model is temporarily unavailable.", true);
  }
  return toApiError("internal", "Unexpected worker error.", true);
}

function toApiError(code: ApiError["code"], message: string, retryable: boolean): ApiError {
  return { code, message, retryable };
}

function isApiError(e: unknown): e is ApiError {
  return !!e && typeof e === "object" && "code" in e && "retryable" in e;
}

console.log(`[worker] listening on queue "${JOB_QUEUE}" (LLM_MODE=${config.LLM_MODE})`);

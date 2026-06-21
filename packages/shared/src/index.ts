/**
 * Shared contract between the API and the web app.
 *
 * Two things in here are load-bearing decisions from the /autoplan review:
 *  - The uniform error envelope (`ApiError`) — `retryable` lets the UI auto-handle
 *    LLM 5xx vs. user error without string-matching messages.
 *  - The async job contract — every generative feature returns a `jobId`, never a
 *    synchronous result, because RCA/summarization take 10–60s.
 */

export type JobType = "ticket_summary" | "sop_search" | "rca";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

/** A citation back to grounding evidence. Trust UX renders these inline. */
export interface Citation {
  /** "sop" → a runbook section; "log" → an attached log line. */
  kind: "sop" | "log" | "ticket";
  /** Human-readable source label, e.g. "Runbook §4.2 — DB failover". */
  label: string;
  /** Opaque id the UI can deep-link to (sop _id, log line number, etc.). */
  ref: string;
  /** The grounded snippet that supports the claim. */
  snippet: string;
}

/** Every AI output carries grounding so the UI can show "verify before acting". */
export interface GroundedResult<T> {
  data: T;
  citations: Citation[];
  /** 0–1. Below `confidenceFloor` the UI must label the answer low-confidence. */
  confidence: number;
  model: string;
  /** True when the redaction proxy scrubbed PII/secrets before the LLM call. */
  redacted: boolean;
}

export interface TicketSummary {
  headline: string;
  summary: string;
  impact: string;
  nextActions: string[];
}

export interface SopSearchAnswer {
  answer: string;
}

export interface RcaDocument {
  title: string;
  rootCause: string;
  contributingFactors: string[];
  timeline: string[];
  remediation: string[];
}

export type JobResultMap = {
  ticket_summary: GroundedResult<TicketSummary>;
  sop_search: GroundedResult<SopSearchAnswer>;
  rca: GroundedResult<RcaDocument>;
};

export interface Job<T extends JobType = JobType> {
  id: string;
  tenantId: string;
  type: T;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  result?: JobResultMap[T];
  error?: ApiError;
}

/** Uniform error envelope returned by every endpoint. */
export interface ApiError {
  code: ApiErrorCode;
  message: string;
  /** UI uses this to decide whether to auto-retry vs. surface to the user. */
  retryable: boolean;
}

export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "budget_exceeded"
  | "redaction_failed"
  | "llm_unavailable"
  | "internal";

export interface ApiErrorBody {
  error: ApiError;
}

/** Server-Sent Event payload streamed on GET /api/jobs/:id/stream. */
export type JobStreamEvent =
  | { type: "status"; status: JobStatus }
  | { type: "token"; text: string }
  | { type: "done"; job: Job }
  | { type: "error"; error: ApiError };

export const CONFIDENCE_FLOOR = 0.55;

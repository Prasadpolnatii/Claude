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
  | "db_unavailable"
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

/* ───────────────────────────────────────────────────────────────────────────
 * Operations Dashboard domain
 *
 * The dashboard surface (incidents, application health, alerts, queues,
 * knowledge base, audit log) shares these contracts between API and web. All
 * timestamps are ISO-8601 strings on the wire; ids are stringified Mongo _ids.
 * ──────────────────────────────────────────────────────────────────────────*/

export type UserRole = "engineer" | "admin";

export type IncidentSeverity = "sev1" | "sev2" | "sev3" | "sev4";
export type IncidentStatus = "open" | "acknowledged" | "mitigated" | "resolved";
export type HealthStatus = "healthy" | "degraded" | "down";
export type AlertSeverity = "critical" | "warning" | "info";
export type AlertStatus = "firing" | "resolved";
export type QueueStatus = "healthy" | "warning" | "critical";

export const INCIDENT_SEVERITIES: readonly IncidentSeverity[] = ["sev1", "sev2", "sev3", "sev4"];
export const INCIDENT_STATUSES: readonly IncidentStatus[] = ["open", "acknowledged", "mitigated", "resolved"];

/** A single entry on an incident's chronological timeline. */
export interface TimelineEvent {
  at: string;
  kind: "detected" | "note" | "ack" | "mitigated" | "resolved" | "status_change" | "alert";
  message: string;
  actor?: string;
}

/** Compact incident shape for the list view. */
export interface IncidentRow {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  service: string;
  acknowledgedBy?: string;
  startedAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

/** Full incident, including the timeline, for the detail view + PDF report. */
export interface IncidentDetail extends IncidentRow {
  summary?: string;
  logSnippet?: string;
  timeline: TimelineEvent[];
}

/** Health snapshot for one application/service, rendered as a card. */
export interface ApplicationHealth {
  id: string;
  name: string;
  service: string;
  status: HealthStatus;
  latencyMsP95: number;
  errorRatePct: number;
  uptimePct: number;
  requestsPerMin: number;
  updatedAt: string;
}

/** A monitoring alert. Streamed in real time and listed historically. */
export interface Alert {
  id: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  service: string;
  source: string;
  value?: string;
  at: string;
  resolvedAt?: string;
}

/** Depth/throughput snapshot for one work queue. `status` is derived. */
export interface QueueStat {
  id: string;
  name: string;
  depth: number;
  inFlight: number;
  ratePerMin: number;
  oldestAgeSec: number;
  consumers: number;
  status: QueueStatus;
  updatedAt: string;
}

/** A knowledge-base / runbook article rendered in the viewer. */
export interface KnowledgeArticle {
  id: string;
  title: string;
  category: string;
  tags: string[];
  body: string;
  updatedAt: string;
}

/** One immutable audit-log row (who did what, when). Admin-visible. */
export interface AuditLogEntry {
  id: string;
  at: string;
  actor: string;
  role: string;
  action: string;
  target: string;
  meta?: Record<string, unknown>;
}

/** Roll-up counters for the dashboard landing page. */
export interface DashboardOverview {
  incidents: { open: number; bySeverity: Record<IncidentSeverity, number> };
  alerts: { firing: number; bySeverity: Record<AlertSeverity, number> };
  applications: { total: number; healthy: number; degraded: number; down: number };
  queues: { total: number; warning: number; critical: number };
  updatedAt: string;
}

/** Server-Sent Event payload streamed on GET /api/alerts/stream. */
export type AlertStreamEvent =
  | { type: "alert"; alert: Alert }
  | { type: "resolved"; alert: Alert }
  | { type: "heartbeat"; at: string };

import type {
  Alert,
  AlertStreamEvent,
  ApiErrorBody,
  ApplicationHealth,
  AuditLogEntry,
  Citation,
  DashboardOverview,
  IncidentDetail,
  IncidentRow,
  Job,
  JobStreamEvent,
  JobType,
  KnowledgeArticle,
  QueueStat,
  UserRole,
} from "@ops-copilot/shared";

/**
 * Tiny API client. Holds the dev JWT in memory (paste from `npm run seed`).
 * The async contract is enforced here: submit → jobId → stream.
 */

let token = localStorage.getItem("ops_token") ?? "";

export function setToken(t: string): void {
  token = t.trim();
  localStorage.setItem("ops_token", token);
}
export function getToken(): string {
  return token;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${token}`, ...extra };
}

export class ApiCallError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean) {
    super(message);
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;
  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  const e = body?.error;
  throw new ApiCallError(e?.code ?? "internal", e?.message ?? res.statusText, e?.retryable ?? false);
}

export async function submitJob(
  type: JobType,
  input: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<{ jobId: string }> {
  const headers = authHeaders(idempotencyKey ? { "idempotency-key": idempotencyKey } : {});
  const res = await fetch("/api/jobs", { method: "POST", headers, body: JSON.stringify({ type, input }) });
  return unwrap(res);
}

/**
 * Stream a job's tokens + final result over SSE. Returns an unsubscribe fn.
 *
 * EventSource can't send an Authorization header, so we first exchange the
 * session JWT (header auth) for a short-lived, job-scoped stream token, then put
 * THAT in the URL — never the long-lived session token.
 */
export async function streamJob(
  jobId: string,
  handlers: {
    onToken?: (t: string) => void;
    onDone?: (job: Job) => void;
    onError?: (code: string, message: string) => void;
  },
): Promise<() => void> {
  let streamToken: string;
  try {
    const res = await fetch(`/api/jobs/${jobId}/stream-token`, { headers: authHeaders() });
    streamToken = (await unwrap<{ streamToken: string }>(res)).streamToken;
  } catch (e) {
    const msg = e instanceof ApiCallError ? e.message : "Failed to authorize stream.";
    handlers.onError?.("stream_auth", msg);
    return () => {};
  }

  const es = new EventSource(`/api/jobs/${jobId}/stream?t=${encodeURIComponent(streamToken)}`);
  es.onmessage = (ev) => {
    const event = JSON.parse(ev.data) as JobStreamEvent;
    if (event.type === "token") handlers.onToken?.(event.text);
    else if (event.type === "done") {
      handlers.onDone?.(event.job);
      es.close();
    } else if (event.type === "error") {
      handlers.onError?.(event.error.code, event.error.message);
      es.close();
    }
  };
  es.onerror = () => {
    handlers.onError?.("stream_error", "Connection to the job stream dropped.");
    es.close();
  };
  return () => es.close();
}

export async function searchSops(q: string): Promise<{ hits: Array<{ id: string; title: string; text: string; score: number }> }> {
  const res = await fetch(`/api/sops/search?q=${encodeURIComponent(q)}`, { headers: authHeaders() });
  return unwrap(res);
}

/** Upload a runbook (PDF / .md / .txt) for chunking + embedding. */
export async function uploadSop(file: File, title?: string): Promise<{ document: string; chunks: number; characters: number }> {
  const form = new FormData();
  form.append("file", file);
  if (title) form.append("title", title);
  // Don't set content-type — the browser sets the multipart boundary.
  const res = await fetch("/api/sops/upload", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return unwrap(res);
}

/** Grounded SOP answer (async job → SSE). Returns the streaming jobId. */
export async function searchSopsGrounded(query: string): Promise<{ jobId: string }> {
  const res = await fetch("/api/sops/search", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ query }),
  });
  return unwrap(res);
}

export interface SavedRca {
  _id: string;
  incidentId?: string;
  title: string;
  rootCause: string;
  contributingFactors: string[];
  timeline: string[];
  remediation: string[];
  confidence?: number;
  citations?: Citation[];
  model?: string;
  editedByHuman: boolean;
  updatedAt: string;
}

/** Start grounded RCA generation (async job → SSE). Returns the streaming jobId. */
export async function generateRca(incidentSummary: string, logSnippet: string): Promise<{ jobId: string }> {
  const res = await fetch("/api/rca/generate", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": crypto.randomUUID() }),
    body: JSON.stringify({ incidentSummary, logSnippet }),
  });
  return unwrap(res);
}

export interface RcaSaveInput {
  incidentId?: string;
  jobId?: string;
  title: string;
  rootCause: string;
  contributingFactors: string[];
  timeline: string[];
  remediation: string[];
  confidence?: number;
  citations?: Citation[];
  editedByHuman: boolean;
}

export async function saveRca(body: RcaSaveInput): Promise<{ rca: SavedRca }> {
  const res = await fetch("/api/rca", { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
  return unwrap(res);
}

export interface TicketRow {
  _id: string;
  title: string;
  body: string;
}

export interface SavedSummary {
  _id: string;
  ticketId: string;
  headline: string;
  summary: string;
  impact: string;
  nextActions: string[];
  confidence?: number;
  citations?: Citation[];
  model?: string;
  editedByHuman: boolean;
  updatedAt: string;
}

export async function listTickets(): Promise<{ tickets: TicketRow[] }> {
  const res = await fetch("/api/tickets", { headers: authHeaders() });
  return unwrap(res);
}

/** Kick off summarization for a stored ticket. Returns the streaming jobId. */
export async function summarizeTicket(ticketId: string): Promise<{ jobId: string; ticketId: string }> {
  const res = await fetch(`/api/tickets/${ticketId}/summarize`, {
    method: "POST",
    headers: authHeaders({ "idempotency-key": crypto.randomUUID() }),
  });
  return unwrap(res);
}

export async function getTicketSummary(ticketId: string): Promise<{ summary: SavedSummary | null }> {
  const res = await fetch(`/api/tickets/${ticketId}/summary`, { headers: authHeaders() });
  return unwrap(res);
}

export interface SummarySaveInput {
  headline: string;
  summary: string;
  impact: string;
  nextActions: string[];
  editedByHuman: boolean;
  jobId?: string;
}

export async function saveTicketSummary(
  ticketId: string,
  body: SummarySaveInput,
): Promise<{ summary: SavedSummary }> {
  const res = await fetch(`/api/tickets/${ticketId}/summary`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  return unwrap(res);
}

/* ───────────────────────────────────────────────────────────────────────────
 * Operations Dashboard
 * ──────────────────────────────────────────────────────────────────────────*/

export interface TokenClaims {
  tenantId?: string;
  sub?: string;
  role?: UserRole;
}

/** Best-effort decode of the JWT payload (unverified — UI gating only). */
export function decodeToken(): TokenClaims {
  try {
    const part = token.split(".")[1];
    if (!part) return {};
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as TokenClaims;
  } catch {
    return {};
  }
}

export function currentRole(): UserRole {
  return decodeToken().role === "admin" ? "admin" : "engineer";
}

export async function getOverview(): Promise<DashboardOverview> {
  const res = await fetch("/api/dashboard", { headers: authHeaders() });
  return (await unwrap<{ overview: DashboardOverview }>(res)).overview;
}

export async function listIncidents(params: { severity?: string[]; status?: string[]; service?: string } = {}): Promise<IncidentRow[]> {
  const qs = new URLSearchParams();
  if (params.severity?.length) qs.set("severity", params.severity.join(","));
  if (params.status?.length) qs.set("status", params.status.join(","));
  if (params.service) qs.set("service", params.service);
  const res = await fetch(`/api/incidents?${qs.toString()}`, { headers: authHeaders() });
  return (await unwrap<{ incidents: IncidentRow[] }>(res)).incidents;
}

export async function getIncident(id: string): Promise<IncidentDetail> {
  const res = await fetch(`/api/incidents/${id}`, { headers: authHeaders() });
  return (await unwrap<{ incident: IncidentDetail }>(res)).incident;
}

async function incidentAction(id: string, path: string, body?: unknown): Promise<IncidentDetail> {
  const res = await fetch(`/api/incidents/${id}/${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  return (await unwrap<{ incident: IncidentDetail }>(res)).incident;
}

export const ackIncident = (id: string) => incidentAction(id, "ack");
export const resolveIncident = (id: string) => incidentAction(id, "resolve");
export const addIncidentNote = (id: string, message: string) => incidentAction(id, "note", { message });

export async function listApplications(): Promise<ApplicationHealth[]> {
  const res = await fetch("/api/applications", { headers: authHeaders() });
  return (await unwrap<{ applications: ApplicationHealth[] }>(res)).applications;
}

export async function listQueues(): Promise<QueueStat[]> {
  const res = await fetch("/api/queues", { headers: authHeaders() });
  return (await unwrap<{ queues: QueueStat[] }>(res)).queues;
}

export async function listAlerts(params: { status?: string; severity?: string } = {}): Promise<Alert[]> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.severity) qs.set("severity", params.severity);
  const res = await fetch(`/api/alerts?${qs.toString()}`, { headers: authHeaders() });
  return (await unwrap<{ alerts: Alert[] }>(res)).alerts;
}

export async function resolveAlert(id: string): Promise<Alert> {
  const res = await fetch(`/api/alerts/${id}/resolve`, { method: "POST", headers: authHeaders() });
  return (await unwrap<{ alert: Alert }>(res)).alert;
}

/**
 * Subscribe to the live alert feed over SSE. Exchanges the session JWT for a
 * short-lived stream token (EventSource can't send headers), then streams.
 * Returns an unsubscribe fn.
 */
export async function streamAlerts(handlers: {
  onAlert?: (alert: Alert) => void;
  onResolved?: (alert: Alert) => void;
  onError?: (message: string) => void;
}): Promise<() => void> {
  let streamToken: string;
  try {
    const res = await fetch("/api/alerts/stream-token", { headers: authHeaders() });
    streamToken = (await unwrap<{ streamToken: string }>(res)).streamToken;
  } catch (e) {
    handlers.onError?.(e instanceof ApiCallError ? e.message : "Failed to authorize alert stream.");
    return () => {};
  }

  const es = new EventSource(`/api/alerts/stream?t=${encodeURIComponent(streamToken)}`);
  es.onmessage = (ev) => {
    const event = JSON.parse(ev.data) as AlertStreamEvent;
    if (event.type === "alert") handlers.onAlert?.(event.alert);
    else if (event.type === "resolved") handlers.onResolved?.(event.alert);
  };
  es.onerror = () => handlers.onError?.("Alert stream connection dropped.");
  return () => es.close();
}

export async function listKnowledge(q?: string): Promise<KnowledgeArticle[]> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  const res = await fetch(`/api/knowledge${qs}`, { headers: authHeaders() });
  return (await unwrap<{ articles: KnowledgeArticle[] }>(res)).articles;
}

export async function listAudit(): Promise<AuditLogEntry[]> {
  const res = await fetch("/api/audit", { headers: authHeaders() });
  return (await unwrap<{ entries: AuditLogEntry[] }>(res)).entries;
}

export interface IncidentReport {
  incident: IncidentDetail;
  relatedAlerts: Alert[];
  generatedAt: string;
  durationMinutes: number | null;
}

export async function getIncidentReport(id: string): Promise<IncidentReport> {
  const res = await fetch(`/api/reports/incident/${id}`, { headers: authHeaders() });
  return (await unwrap<{ report: IncidentReport }>(res)).report;
}

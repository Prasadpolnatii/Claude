import type { ApiErrorBody, Citation, Job, JobStreamEvent, JobType } from "@ops-copilot/shared";

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
 * `EventSource` can't send Authorization headers, so the token rides as a query
 * param in dev. In production, prefer a short-lived signed stream URL.
 */
export function streamJob(
  jobId: string,
  handlers: {
    onToken?: (t: string) => void;
    onDone?: (job: Job) => void;
    onError?: (code: string, message: string) => void;
  },
): () => void {
  const es = new EventSource(`/api/jobs/${jobId}/stream?access_token=${encodeURIComponent(token)}`);
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

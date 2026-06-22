import type {
  Alert,
  ApplicationHealth,
  AuditLogEntry,
  IncidentDetail,
  IncidentRow,
  KnowledgeArticle,
  QueueStat,
  QueueStatus,
  TimelineEvent,
} from "@ops-copilot/shared";
import type {
  AlertDoc,
  ApplicationDoc,
  AuditLogDoc,
  IncidentDoc,
  KnowledgeDoc,
  QueueStatDoc,
} from "../models/index.js";

/**
 * Wire serializers — the single place Mongoose documents become the shared
 * contract types the web app consumes. Centralized so id-stringification and
 * date→ISO conversion happen exactly once and identically everywhere (routes +
 * the alert simulator both go through here).
 */

const iso = (d: Date | undefined | null): string | undefined => (d ? new Date(d).toISOString() : undefined);

export function serializeIncidentRow(doc: IncidentDoc): IncidentRow {
  return {
    id: String(doc._id),
    title: doc.title,
    severity: doc.severity as IncidentRow["severity"],
    status: doc.status as IncidentRow["status"],
    service: doc.service ?? "unknown",
    acknowledgedBy: doc.acknowledgedBy ?? undefined,
    startedAt: iso(doc.startedAt) ?? new Date().toISOString(),
    updatedAt: iso((doc as { updatedAt?: Date }).updatedAt) ?? new Date().toISOString(),
    resolvedAt: iso(doc.resolvedAt),
  };
}

export function serializeIncidentDetail(doc: IncidentDoc): IncidentDetail {
  const timeline: TimelineEvent[] = (doc.timeline ?? []).map((e) => ({
    at: iso(e.at) ?? new Date().toISOString(),
    kind: e.kind as TimelineEvent["kind"],
    message: e.message,
    actor: e.actor ?? undefined,
  }));
  return {
    ...serializeIncidentRow(doc),
    summary: doc.summary ?? undefined,
    logSnippet: doc.logSnippet ?? undefined,
    timeline,
  };
}

/** Health status derives from the live SLO numbers, not a stored field. */
export function deriveHealth(errorRatePct: number, latencyMsP95: number): ApplicationHealth["status"] {
  if (errorRatePct >= 5 || latencyMsP95 >= 2000) return "down";
  if (errorRatePct >= 1 || latencyMsP95 >= 800) return "degraded";
  return "healthy";
}

export function serializeApplication(doc: ApplicationDoc): ApplicationHealth {
  return {
    id: String(doc._id),
    name: doc.name,
    service: doc.service,
    status: deriveHealth(doc.errorRatePct ?? 0, doc.latencyMsP95 ?? 0),
    latencyMsP95: doc.latencyMsP95 ?? 0,
    errorRatePct: Number((doc.errorRatePct ?? 0).toFixed(2)),
    uptimePct: Number((doc.uptimePct ?? 100).toFixed(2)),
    requestsPerMin: doc.requestsPerMin ?? 0,
    updatedAt: iso((doc as { updatedAt?: Date }).updatedAt) ?? new Date().toISOString(),
  };
}

export function serializeAlert(doc: AlertDoc): Alert {
  return {
    id: String(doc._id),
    severity: doc.severity as Alert["severity"],
    status: doc.status as Alert["status"],
    title: doc.title,
    service: doc.service ?? "",
    source: doc.source ?? "monitor",
    value: doc.value ?? undefined,
    at: iso(doc.firedAt) ?? new Date().toISOString(),
    resolvedAt: iso(doc.resolvedAt),
  };
}

/** Queue health derives from depth + age thresholds. */
export function deriveQueueStatus(depth: number, oldestAgeSec: number): QueueStatus {
  if (depth >= 1000 || oldestAgeSec >= 600) return "critical";
  if (depth >= 200 || oldestAgeSec >= 120) return "warning";
  return "healthy";
}

export function serializeQueue(doc: QueueStatDoc): QueueStat {
  const depth = doc.depth ?? 0;
  const oldestAgeSec = doc.oldestAgeSec ?? 0;
  return {
    id: String(doc._id),
    name: doc.name,
    depth,
    inFlight: doc.inFlight ?? 0,
    ratePerMin: doc.ratePerMin ?? 0,
    oldestAgeSec,
    consumers: doc.consumers ?? 0,
    status: deriveQueueStatus(depth, oldestAgeSec),
    updatedAt: iso((doc as { updatedAt?: Date }).updatedAt) ?? new Date().toISOString(),
  };
}

export function serializeKnowledge(doc: KnowledgeDoc): KnowledgeArticle {
  return {
    id: String(doc._id),
    title: doc.title,
    category: doc.category ?? "general",
    tags: doc.tags ?? [],
    body: doc.body,
    updatedAt: iso((doc as { updatedAt?: Date }).updatedAt) ?? new Date().toISOString(),
  };
}

export function serializeAudit(doc: AuditLogDoc): AuditLogEntry {
  return {
    id: String(doc._id),
    at: iso(doc.at) ?? new Date().toISOString(),
    actor: doc.actor,
    role: doc.role ?? "",
    action: doc.action,
    target: doc.target ?? "",
    meta: (doc.meta as Record<string, unknown> | undefined) ?? undefined,
  };
}

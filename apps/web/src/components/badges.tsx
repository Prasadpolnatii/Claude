import type { AlertSeverity, HealthStatus, IncidentSeverity, IncidentStatus, QueueStatus } from "@ops-copilot/shared";

/**
 * Small, consistent status pills used across the dashboard. Color is driven by
 * CSS classes (theme-aware variables) rather than inline styles so dark/light
 * both look right.
 */

const SEVERITY_LABEL: Record<IncidentSeverity, string> = { sev1: "SEV1", sev2: "SEV2", sev3: "SEV3", sev4: "SEV4" };

export function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  return <span className={`badge sev sev--${severity}`}>{SEVERITY_LABEL[severity]}</span>;
}

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  return <span className={`badge st st--${status}`}>{status}</span>;
}

export function AlertSeverityBadge({ severity }: { severity: AlertSeverity }) {
  return <span className={`badge alev alev--${severity}`}>{severity}</span>;
}

export function HealthDot({ status }: { status: HealthStatus }) {
  return <span className={`dot dot--${status}`} title={status} aria-label={status} />;
}

export function QueueStatusBadge({ status }: { status: QueueStatus }) {
  return <span className={`badge q q--${status}`}>{status}</span>;
}

/** Relative time like "3m ago" / "2h ago". */
export function timeAgo(iso: string): string {
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

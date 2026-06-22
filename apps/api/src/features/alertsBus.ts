import { EventEmitter } from "node:events";
import type { Alert } from "@ops-copilot/shared";
import { config } from "../config.js";
import { isMongoConnected } from "../db/mongo.js";
import { Alert as AlertModel } from "../models/index.js";
import { serializeAlert } from "./serialize.js";

/**
 * In-process alert bus. A real deployment would push alerts here from a
 * monitoring webhook (Prometheus Alertmanager, Datadog, etc.); the SSE route
 * subscribes and fans them out to connected on-call engineers in real time.
 *
 * For demos with no monitoring pipeline, `startAlertSimulator()` synthesizes
 * believable alerts on an interval. It's pure plumbing — the bus contract is
 * identical whether the producer is real or simulated.
 */

export interface AlertBusEvent {
  tenantId: string;
  kind: "alert" | "resolved";
  alert: Alert;
}

const bus = new EventEmitter();
// One listener per open SSE connection; lift the cap so many concurrent
// on-call viewers don't trip MaxListenersExceededWarning. Cleaned up on close.
bus.setMaxListeners(0);

export function publishAlert(event: AlertBusEvent): void {
  bus.emit("alert", event);
}

/** Subscribe to a tenant's alert stream. Returns an unsubscribe fn. */
export function subscribeAlerts(tenantId: string, handler: (event: AlertBusEvent) => void): () => void {
  const fn = (event: AlertBusEvent): void => {
    if (event.tenantId === tenantId) handler(event);
  };
  bus.on("alert", fn);
  return () => bus.off("alert", fn);
}

// ── Simulator ────────────────────────────────────────────────────────────────

const SCENARIOS: ReadonlyArray<Pick<Alert, "severity" | "title" | "service" | "source"> & { value?: string }> = [
  { severity: "critical", title: "p95 latency above SLO", service: "checkout-api", source: "prometheus", value: "2.4s" },
  { severity: "critical", title: "Error rate spike (5xx)", service: "payments-api", source: "datadog", value: "7.1%" },
  { severity: "warning", title: "DB connection pool saturated", service: "orders-db", source: "prometheus", value: "92%" },
  { severity: "warning", title: "Queue backlog growing", service: "email-worker", source: "bullmq", value: "1.2k" },
  { severity: "warning", title: "Cache hit rate dropped", service: "catalog-api", source: "datadog", value: "61%" },
  { severity: "info", title: "Deploy started", service: "checkout-api", source: "ci", value: "v2.4.2" },
  { severity: "info", title: "Autoscaler added replica", service: "search-api", source: "k8s" },
];

let timer: NodeJS.Timeout | null = null;

/**
 * Start emitting synthetic alerts for the configured demo tenant. No-op when
 * disabled. Persists each alert (when Mongo is up) so it also appears in the
 * historical list, then publishes to the bus for live subscribers. Occasionally
 * resolves an older firing alert to keep the feed realistic.
 */
export function startAlertSimulator(): void {
  if (!config.ALERTS_SIMULATE || timer) return;
  const tenantId = config.ALERTS_SIMULATE_TENANT;

  timer = setInterval(() => {
    void tick(tenantId).catch((err) => console.warn("[alerts] simulator tick failed", err));
  }, config.ALERTS_SIMULATE_INTERVAL_MS);
  // Don't keep the event loop alive solely for the simulator.
  timer.unref?.();
  console.log(`[alerts] simulator on for tenant "${tenantId}" every ${config.ALERTS_SIMULATE_INTERVAL_MS}ms`);
}

export function stopAlertSimulator(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick(tenantId: string): Promise<void> {
  if (!isMongoConnected()) return; // alerts are persisted; nothing to do without a DB

  // ~25% of ticks resolve an existing firing alert instead of creating one.
  if (Math.random() < 0.25) {
    const firing = await AlertModel.findOne({ tenantId, status: "firing" }).sort({ firedAt: 1 });
    if (firing) {
      firing.status = "resolved";
      firing.resolvedAt = new Date();
      await firing.save();
      publishAlert({ tenantId, kind: "resolved", alert: serializeAlert(firing) });
      return;
    }
  }

  const s = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)]!;
  const doc = await AlertModel.create({
    tenantId,
    severity: s.severity,
    status: s.severity === "info" ? "resolved" : "firing",
    title: s.title,
    service: s.service,
    source: s.source,
    value: s.value,
    firedAt: new Date(),
    resolvedAt: s.severity === "info" ? new Date() : undefined,
  });
  publishAlert({ tenantId, kind: doc.status === "resolved" ? "resolved" : "alert", alert: serializeAlert(doc) });
}

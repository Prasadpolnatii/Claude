import { EventEmitter } from "node:events";
import type { Alert } from "@ops-copilot/shared";

/**
 * In-process alert bus (pure pub/sub — no config/DB deps, so it's trivially
 * testable). A real deployment pushes alerts here from a monitoring webhook
 * (Prometheus Alertmanager, Datadog, etc.); the SSE route subscribes and fans
 * them out to connected on-call engineers in real time. The demo producer lives
 * in `alertSimulator.ts`.
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

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Alert } from "@ops-copilot/shared";
import { publishAlert, subscribeAlerts } from "./alertsBus.ts";

const sample = (id: string): Alert => ({
  id,
  severity: "warning",
  status: "firing",
  title: "test",
  service: "svc",
  source: "test",
  at: new Date().toISOString(),
});

test("subscribeAlerts: delivers only events for the subscribed tenant", () => {
  const received: string[] = [];
  const unsub = subscribeAlerts("t1", (ev) => received.push(ev.alert.id));

  publishAlert({ tenantId: "t1", kind: "alert", alert: sample("a") });
  publishAlert({ tenantId: "t2", kind: "alert", alert: sample("b") }); // other tenant — ignored
  publishAlert({ tenantId: "t1", kind: "resolved", alert: sample("c") });

  unsub();
  publishAlert({ tenantId: "t1", kind: "alert", alert: sample("d") }); // after unsubscribe — ignored

  assert.deepEqual(received, ["a", "c"]);
});

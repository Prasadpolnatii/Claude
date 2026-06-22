import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveHealth, deriveQueueStatus } from "./serialize.ts";

test("deriveHealth: thresholds on error rate and latency", () => {
  // healthy band
  assert.equal(deriveHealth(0, 100), "healthy");
  assert.equal(deriveHealth(0.9, 700), "healthy");
  // degraded band (either signal trips it)
  assert.equal(deriveHealth(1, 100), "degraded");
  assert.equal(deriveHealth(0, 800), "degraded");
  assert.equal(deriveHealth(4.9, 1999), "degraded");
  // down band (worst signal wins)
  assert.equal(deriveHealth(5, 100), "down");
  assert.equal(deriveHealth(0, 2000), "down");
  assert.equal(deriveHealth(0.1, 5000), "down");
});

test("deriveQueueStatus: thresholds on depth and oldest-item age", () => {
  assert.equal(deriveQueueStatus(0, 0), "healthy");
  assert.equal(deriveQueueStatus(199, 119), "healthy");
  // warning band
  assert.equal(deriveQueueStatus(200, 0), "warning");
  assert.equal(deriveQueueStatus(0, 120), "warning");
  // critical band (either signal trips it)
  assert.equal(deriveQueueStatus(1000, 0), "critical");
  assert.equal(deriveQueueStatus(0, 600), "critical");
  assert.equal(deriveQueueStatus(5000, 5), "critical");
});

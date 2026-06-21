import { test, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Grounding test for generateRca against the mock LLM. Exercises the full
 * pipeline: redaction → SOP retrieval (Redis mock store) → grounded RCA with
 * log + SOP citations. Needs Redis; skips cleanly if it isn't reachable so the
 * suite stays green in hermetic environments.
 */
process.env.LLM_MODE = "mock";
process.env.JWT_SECRET = "test-secret-at-least-16-chars-long";

const { generateRca } = await import("./orchestrator.ts");
const { addSopChunks } = await import("../features/sopStore.ts");
const { mockStore } = await import("../features/redisStore.ts");

let redisOk = false;
try {
  await mockStore.connect();
  redisOk = true;
} catch {
  redisOk = false;
}
after(async () => {
  if (redisOk) await mockStore.quit().catch(() => {});
});

const TENANT = `rca-test-${Date.now()}`;

test(
  "generateRca returns a schema-valid, redacted RCA grounded in log + SOP",
  { skip: redisOk ? false : "redis unavailable" },
  async () => {
    await addSopChunks(TENANT, "Failover Runbook", [
      { text: "On pool exhaustion, enable the circuit breaker and cap retries to 2.", index: 0 },
    ]);

    const r = await generateRca(
      { tenantId: TENANT, jobId: "job-rca-1" },
      "Checkout 5xx for alice@example.com after the deploy.",
      "ERROR pool timeout from 10.0.0.1 (waiting=312)",
    );

    // Schema-valid RcaDocument.
    assert.ok(r.data.title.length > 0);
    assert.ok(r.data.rootCause.length > 0);
    assert.ok(Array.isArray(r.data.remediation));

    // Redaction held end to end.
    assert.equal(r.redacted, true);
    const blob = JSON.stringify(r);
    for (const secret of ["alice@example.com", "10.0.0.1"]) {
      assert.ok(!blob.includes(secret), `PII leaked: ${secret}`);
    }

    // Grounded in both the attached log and a retrieved SOP.
    const kinds = r.citations.map((c) => c.kind);
    assert.ok(kinds.includes("log"), "expected a log citation");
    assert.ok(kinds.includes("sop"), "expected a SOP citation");
    assert.ok(r.confidence >= 0 && r.confidence <= 1);
  },
);

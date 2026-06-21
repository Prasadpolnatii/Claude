import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit test for the Ticket Summarization pipeline (the first production feature).
 * Runs the orchestrator against the mock LLM — no Mongo, no Redis, no API key.
 * Asserts the three guarantees that matter: schema-valid output, redaction held,
 * and grounded citation/confidence.
 *
 * Env must be set before importing config (which validates it), so imports are
 * dynamic.
 */
process.env.LLM_MODE = "mock";
process.env.JWT_SECRET = "test-secret-at-least-16-chars-long";

const { summarizeTicket } = await import("./orchestrator.ts");
const { CONFIDENCE_FLOOR } = await import("@ops-copilot/shared");

test("summarizeTicket returns schema-valid, grounded output", async () => {
  const result = await summarizeTicket(
    { tenantId: "t1", jobId: "job-1" },
    "Checkout failing since the 2.4.1 deploy; users see 8s latency.",
  );

  // Schema-valid TicketSummary shape.
  assert.equal(typeof result.data.headline, "string");
  assert.ok(result.data.headline.length > 0);
  assert.ok(Array.isArray(result.data.nextActions));

  // Grounded: cites the source ticket, confidence above the floor.
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0]!.kind, "ticket");
  assert.ok(result.confidence >= CONFIDENCE_FLOOR);
});

test("redaction holds across the summarization pipeline", async () => {
  const result = await summarizeTicket(
    { tenantId: "t1", jobId: "job-2" },
    "Reported by alice@example.com from 10.1.2.3 with token sk-abcdef0123456789abcdef",
  );

  assert.equal(result.redacted, true, "redacted flag should be set when PII was present");

  const blob = JSON.stringify(result);
  for (const secret of ["alice@example.com", "10.1.2.3", "sk-abcdef0123456789abcdef"]) {
    assert.ok(!blob.includes(secret), `PII leaked into result: ${secret}`);
  }
  // The citation snippet should show the redaction placeholder, proving the
  // model only ever saw scrubbed text.
  assert.ok(result.citations[0]!.snippet.includes("[REDACTED:"), "expected redacted snippet");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { ticketSummaryInputSchema } from "./summary.ts";

/**
 * Validation for the human-edited summary save payload. Pure schema, no Mongo.
 */

test("accepts a valid payload and applies defaults", () => {
  const out = ticketSummaryInputSchema.parse({ headline: "DB failover", summary: "12m partial outage." });
  assert.equal(out.headline, "DB failover");
  assert.equal(out.impact, "");
  assert.deepEqual(out.nextActions, []);
  assert.equal(out.editedByHuman, false);
});

test("trims and rejects empty headline/summary", () => {
  assert.equal(ticketSummaryInputSchema.parse({ headline: "  x  ", summary: "y" }).headline, "x");
  assert.equal(ticketSummaryInputSchema.safeParse({ headline: "   ", summary: "y" }).success, false);
  assert.equal(ticketSummaryInputSchema.safeParse({ headline: "x", summary: "" }).success, false);
});

test("enforces upper bounds (headline length, nextActions count)", () => {
  assert.equal(ticketSummaryInputSchema.safeParse({ headline: "a".repeat(201), summary: "y" }).success, false);
  const tooManyActions = { headline: "h", summary: "s", nextActions: Array(21).fill("a") };
  assert.equal(ticketSummaryInputSchema.safeParse(tooManyActions).success, false);
});

test("carries editedByHuman and jobId through", () => {
  const out = ticketSummaryInputSchema.parse({
    headline: "h",
    summary: "s",
    editedByHuman: true,
    jobId: "idem_t_summ_1",
  });
  assert.equal(out.editedByHuman, true);
  assert.equal(out.jobId, "idem_t_summ_1");
});

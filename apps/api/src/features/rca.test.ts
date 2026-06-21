import { test } from "node:test";
import assert from "node:assert/strict";
import { rcaGenerateSchema, rcaSaveInputSchema } from "./rca.ts";

test("generate schema requires an incident summary, defaults logSnippet", () => {
  const ok = rcaGenerateSchema.parse({ incidentSummary: "5xx after deploy" });
  assert.equal(ok.logSnippet, "");
  assert.equal(rcaGenerateSchema.safeParse({ incidentSummary: "" }).success, false);
});

test("save schema validates required fields and applies list defaults", () => {
  const out = rcaSaveInputSchema.parse({ title: "RCA: pool exhaustion", rootCause: "retry storm" });
  assert.deepEqual(out.contributingFactors, []);
  assert.deepEqual(out.timeline, []);
  assert.deepEqual(out.remediation, []);
  assert.equal(out.editedByHuman, false);
});

test("save schema rejects empty title/rootCause and out-of-range confidence", () => {
  assert.equal(rcaSaveInputSchema.safeParse({ title: "", rootCause: "x" }).success, false);
  assert.equal(rcaSaveInputSchema.safeParse({ title: "t", rootCause: "" }).success, false);
  assert.equal(rcaSaveInputSchema.safeParse({ title: "t", rootCause: "r", confidence: 1.5 }).success, false);
});

test("save schema carries incidentId, editedByHuman, and jobId", () => {
  const out = rcaSaveInputSchema.parse({
    title: "t",
    rootCause: "r",
    incidentId: "inc-1",
    editedByHuman: true,
    jobId: "idem_t_rca_1",
  });
  assert.equal(out.incidentId, "inc-1");
  assert.equal(out.editedByHuman, true);
  assert.equal(out.jobId, "idem_t_rca_1");
});

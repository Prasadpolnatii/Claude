import { test, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Integration tests against a REAL MongoDB (set MONGODB_URI). They verify the
 * DB-backed flows the unit suite can't: persistence (tickets/summaries/RCA) and
 * SOP store → retrieval. Skips cleanly when no Mongo is reachable, so the suite
 * stays green in sandboxes without a database; CI runs them against a mongo
 * service.
 *
 * Note: local mongo:7 has no $vectorSearch, so SOP retrieval exercises the cosine
 * fallback over real Mongo documents. Atlas Vector Search is verified via the
 * index definition (apps/api/atlas/sop_vector_index.json), not executed here.
 */
process.env.LLM_MODE = "mock";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "integration-secret-at-least-16";
process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS = "2500";

const { connectMongo, disconnectMongo, isMongoConnected } = await import("../db/mongo.ts");
const { ensureCollectionIndexes } = await import("../db/indexes.ts");
const { Ticket, Summary, Rca } = await import("../models/index.ts");
const { summarizeTicket, generateRca } = await import("../llm/orchestrator.ts");
const { addSopChunks, searchSops } = await import("../features/sopStore.ts");
const { redis } = await import("../features/redisStore.ts");

let dbOk = false;
try {
  await connectMongo();
  dbOk = isMongoConnected();
} catch {
  dbOk = false;
}

const TENANT = `it-${Date.now()}`;
const skip = dbOk ? false : "no MongoDB reachable (set MONGODB_URI)";

before(async () => {
  if (dbOk) await ensureCollectionIndexes();
});

after(async () => {
  if (dbOk) {
    await Promise.all([
      Ticket.deleteMany({ tenantId: TENANT }),
      Summary.deleteMany({ tenantId: TENANT }),
      Rca.deleteMany({ tenantId: TENANT }),
      (await import("../models/index.ts")).Sop.deleteMany({ tenantId: TENANT }),
    ]).catch(() => {});
    await disconnectMongo();
    await redis.quit().catch(() => {});
  }
});

test("ticket summary persists and upsert keeps one per ticket", { skip }, async () => {
  const ticket = await Ticket.create({ tenantId: TENANT, title: "Checkout slow", body: "Checkout 8s since deploy." });
  const result = await summarizeTicket({ tenantId: TENANT, jobId: "it-job-1" }, String(ticket.body));

  const save = () =>
    Summary.findOneAndUpdate(
      { tenantId: TENANT, ticketId: ticket._id },
      { $set: { headline: result.data.headline, summary: result.data.summary, impact: result.data.impact, nextActions: result.data.nextActions, editedByHuman: false } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();

  const first = await save();
  assert.ok(first, "summary saved");
  const second = await save(); // upsert again — must not duplicate
  assert.equal(String(first!._id), String(second!._id), "upsert reuses the same doc");

  const count = await Summary.countDocuments({ tenantId: TENANT, ticketId: ticket._id });
  assert.equal(count, 1, "exactly one summary per ticket");
});

test("SOP upload → store → retrieval returns grounded hits from Mongo", { skip }, async () => {
  const stored = await addSopChunks(TENANT, "Failover Runbook", [
    { text: "On pool exhaustion, enable the circuit breaker and cap client retries to 2.", index: 0 },
    { text: "For DB failover, promote the standby and watch the error rate for 10 minutes.", index: 1 },
  ]);
  assert.equal(stored, 2, "stored both chunks in Mongo");
  assert.ok(isMongoConnected(), "using the Mongo path, not the Redis mock store");

  const hits = await searchSops(TENANT, "how do I handle connection pool exhaustion", 5);
  assert.ok(hits.length > 0, "retrieved SOP chunks from Mongo");
  assert.ok(hits[0]!.title === "Failover Runbook");
});

test("RCA generates grounded from Mongo SOPs and persists", { skip }, async () => {
  const r = await generateRca(
    { tenantId: TENANT, jobId: "it-job-2" },
    "Checkout 5xx after the 2.4.1 deploy.",
    "ERROR pool timeout (waiting=312)",
  );
  const kinds = r.citations.map((c) => c.kind);
  assert.ok(kinds.includes("log") && kinds.includes("sop"), "grounded in log + Mongo SOP");

  const saved = await Rca.create({
    tenantId: TENANT,
    incidentId: "inc-it-1",
    title: r.data.title,
    rootCause: r.data.rootCause,
    contributingFactors: r.data.contributingFactors,
    timeline: r.data.timeline,
    remediation: r.data.remediation,
    confidence: r.confidence,
    citations: r.citations,
    editedByHuman: false,
  });

  const fetched = await Rca.findOne({ _id: saved._id, tenantId: TENANT }).lean();
  assert.ok(fetched, "RCA retrievable by id + tenant");
  assert.equal(fetched!.title, r.data.title);
});

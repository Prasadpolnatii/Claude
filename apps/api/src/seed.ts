import { connectMongo, disconnectMongo } from "./db/mongo.js";
import {
  Alert,
  Application,
  Incident,
  Knowledge,
  QueueStat,
  Sop,
  Ticket,
  User,
} from "./models/index.js";
import { embed } from "./llm/client.js";
import { signDevToken } from "./auth/jwt.js";

/**
 * Seed a demo tenant so a developer can exercise the full dashboard in minutes:
 * incidents, application health, alerts, queues, knowledge base, plus the SOP
 * corpus and tickets for the AI features. Prints admin + engineer dev JWTs.
 *
 *   npm run seed
 */

const TENANT = "demo-tenant";
const ADMIN = "demo-admin";
const ENGINEER = "demo-engineer";

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000);

const SOPS = [
  {
    title: "Runbook §4 — Database failover",
    section: "4",
    text: "When the primary DB is unhealthy: 1) confirm replica lag < 5s, 2) promote the standby with `db-failover promote`, 3) update the connection string in the config service, 4) watch checkout error rate for 10 minutes.",
  },
  {
    title: "Runbook §7 — 5xx spike triage",
    section: "7",
    text: "On elevated 5xx after a deploy: check connection pool saturation first. A retry storm exhausts the pool. Mitigate by enabling the circuit breaker and capping client retries to 2.",
  },
  {
    title: "Runbook §9 — Cache stampede",
    section: "9",
    text: "If cache hit rate collapses, suspect a stampede after a mass key expiry. Enable request coalescing and stagger TTLs.",
  },
];

const TICKETS = [
  { title: "Checkout slow", body: "Customers report checkout taking 8+ seconds since ~14:05. Started right after the 2.4.1 deploy." },
  { title: "Login 500s", body: "Intermittent 500s on /login. Logs show 'connection pool timeout'." },
];

const APPLICATIONS = [
  { name: "Checkout API", service: "checkout-api", latencyMsP95: 2400, errorRatePct: 6.2, uptimePct: 99.1, requestsPerMin: 4200 },
  { name: "Payments API", service: "payments-api", latencyMsP95: 950, errorRatePct: 1.4, uptimePct: 99.7, requestsPerMin: 1800 },
  { name: "Catalog API", service: "catalog-api", latencyMsP95: 320, errorRatePct: 0.2, uptimePct: 99.98, requestsPerMin: 9100 },
  { name: "Search API", service: "search-api", latencyMsP95: 180, errorRatePct: 0.05, uptimePct: 99.99, requestsPerMin: 6400 },
  { name: "Orders DB", service: "orders-db", latencyMsP95: 70, errorRatePct: 0.0, uptimePct: 100, requestsPerMin: 5200 },
  { name: "Email Worker", service: "email-worker", latencyMsP95: 540, errorRatePct: 0.8, uptimePct: 99.9, requestsPerMin: 320 },
];

const QUEUES = [
  { name: "email-outbound", depth: 1240, inFlight: 8, ratePerMin: 90, oldestAgeSec: 410, consumers: 4 },
  { name: "webhook-dispatch", depth: 320, inFlight: 12, ratePerMin: 260, oldestAgeSec: 75, consumers: 6 },
  { name: "report-generation", depth: 12, inFlight: 2, ratePerMin: 30, oldestAgeSec: 15, consumers: 2 },
  { name: "search-index", depth: 60, inFlight: 4, ratePerMin: 140, oldestAgeSec: 22, consumers: 3 },
];

const KNOWLEDGE = [
  {
    title: "On-call escalation policy",
    category: "process",
    tags: ["oncall", "escalation", "sev1"],
    body: "## Escalation\n\n- **SEV1**: page the secondary within 5 minutes; open a war room.\n- **SEV2**: acknowledge within 15 minutes.\n- Always post a status update in #incidents every 30 minutes.\n\nIf you cannot reach the service owner within 10 minutes, escalate to the on-call EM.",
  },
  {
    title: "Database failover walkthrough",
    category: "runbook",
    tags: ["database", "failover", "checkout"],
    body: "## Failover\n\n1. Confirm replica lag `< 5s` in the DB dashboard.\n2. Promote the standby: `db-failover promote --confirm`.\n3. Update the connection string in the config service.\n4. Watch checkout error rate for 10 minutes before declaring mitigated.",
  },
  {
    title: "Reducing 5xx after a deploy",
    category: "runbook",
    tags: ["5xx", "deploy", "connection-pool"],
    body: "## 5xx triage\n\nA retry storm exhausts the connection pool. Mitigate by:\n\n- Enabling the circuit breaker.\n- Capping client retries to 2.\n- Rolling back the most recent deploy if error rate stays above 2% for 10 minutes.",
  },
];

async function main() {
  await connectMongo();

  await Promise.all([
    User.deleteMany({ tenantId: TENANT }),
    Sop.deleteMany({ tenantId: TENANT }),
    Ticket.deleteMany({ tenantId: TENANT }),
    Incident.deleteMany({ tenantId: TENANT }),
    Application.deleteMany({ tenantId: TENANT }),
    Alert.deleteMany({ tenantId: TENANT }),
    QueueStat.deleteMany({ tenantId: TENANT }),
    Knowledge.deleteMany({ tenantId: TENANT }),
  ]);

  await User.insertMany([
    { tenantId: TENANT, email: "admin@example.com", role: "admin" },
    { tenantId: TENANT, email: "engineer@example.com", role: "engineer" },
  ]);

  for (const sop of SOPS) {
    const embedding = await embed(sop.text);
    await Sop.create({ ...sop, tenantId: TENANT, embedding });
  }
  await Ticket.insertMany(TICKETS.map((t) => ({ ...t, tenantId: TENANT })));
  await Application.insertMany(APPLICATIONS.map((a) => ({ ...a, tenantId: TENANT })));
  await QueueStat.insertMany(QUEUES.map((q) => ({ ...q, tenantId: TENANT })));
  await Knowledge.insertMany(KNOWLEDGE.map((k) => ({ ...k, tenantId: TENANT })));

  await Incident.create([
    {
      tenantId: TENANT,
      title: "Checkout latency breaching SLO",
      service: "checkout-api",
      severity: "sev1",
      status: "acknowledged",
      summary: "p95 latency on checkout-api climbed to 2.4s after the 2.4.1 deploy, breaching the 800ms SLO.",
      logSnippet: "ERROR pool: connection pool timeout after 5000ms (active=200, idle=0)",
      acknowledgedBy: ENGINEER,
      startedAt: minsAgo(42),
      timeline: [
        { at: minsAgo(42), kind: "detected", message: "Alert: p95 latency above SLO on checkout-api", actor: "monitor" },
        { at: minsAgo(40), kind: "ack", message: `Acknowledged by ${ENGINEER}`, actor: ENGINEER },
        { at: minsAgo(31), kind: "note", message: "Connection pool saturated; suspect retry storm from 2.4.1.", actor: ENGINEER },
      ],
    },
    {
      tenantId: TENANT,
      title: "Elevated 5xx on payments-api",
      service: "payments-api",
      severity: "sev2",
      status: "open",
      summary: "Intermittent 5xx errors on payments-api, ~1.4% of requests.",
      startedAt: minsAgo(18),
      timeline: [{ at: minsAgo(18), kind: "detected", message: "Alert: error rate spike (5xx) on payments-api", actor: "monitor" }],
    },
    {
      tenantId: TENANT,
      title: "Cache hit rate dip on catalog-api",
      service: "catalog-api",
      severity: "sev3",
      status: "resolved",
      summary: "Cache hit rate briefly dropped to 61% after a mass key expiry.",
      startedAt: minsAgo(220),
      resolvedAt: minsAgo(180),
      timeline: [
        { at: minsAgo(220), kind: "detected", message: "Alert: cache hit rate dropped on catalog-api", actor: "monitor" },
        { at: minsAgo(205), kind: "note", message: "Staggered TTLs and enabled request coalescing.", actor: ENGINEER },
        { at: minsAgo(180), kind: "resolved", message: `Resolved by ${ENGINEER}`, actor: ENGINEER },
      ],
    },
  ]);

  await Alert.insertMany([
    { tenantId: TENANT, severity: "critical", status: "firing", title: "p95 latency above SLO", service: "checkout-api", source: "prometheus", value: "2.4s", firedAt: minsAgo(42) },
    { tenantId: TENANT, severity: "warning", status: "firing", title: "Error rate spike (5xx)", service: "payments-api", source: "datadog", value: "1.4%", firedAt: minsAgo(18) },
    { tenantId: TENANT, severity: "warning", status: "firing", title: "Queue backlog growing", service: "email-worker", source: "bullmq", value: "1.2k", firedAt: minsAgo(9) },
    { tenantId: TENANT, severity: "info", status: "resolved", title: "Deploy started", service: "checkout-api", source: "ci", value: "v2.4.1", firedAt: minsAgo(45), resolvedAt: minsAgo(44) },
    { tenantId: TENANT, severity: "warning", status: "resolved", title: "Cache hit rate dropped", service: "catalog-api", source: "datadog", value: "61%", firedAt: minsAgo(220), resolvedAt: minsAgo(180) },
  ]);

  const adminToken = signDevToken(TENANT, ADMIN, "admin");
  const engToken = signDevToken(TENANT, ENGINEER, "engineer");

  console.log("\n✅ Seeded demo tenant.");
  console.log(
    `   Incidents: 3  Applications: ${APPLICATIONS.length}  Alerts: 5  Queues: ${QUEUES.length}  SOPs: ${SOPS.length}  Articles: ${KNOWLEDGE.length}`,
  );
  console.log("\n🔑 Admin JWT (12h) — full access incl. audit log:\n");
  console.log(adminToken);
  console.log("\n🔑 Engineer JWT (12h) — no audit log (RBAC 403):\n");
  console.log(engToken);
  console.log("\nTry it:\n");
  console.log(`  curl -s localhost:4000/api/incidents -H "authorization: Bearer ${adminToken.slice(0, 12)}..."\n`);

  await disconnectMongo();
}

main().catch((err) => {
  console.error("[seed] failed", err);
  process.exit(1);
});

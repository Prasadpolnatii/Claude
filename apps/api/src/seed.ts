import { connectMongo, disconnectMongo } from "./db/mongo.js";
import { Sop, Ticket, User } from "./models/index.js";
import { embed } from "./llm/client.js";
import { signDevToken } from "./auth/jwt.js";

/**
 * Seed a demo tenant so a developer can exercise the full flow in minutes.
 * Prints a dev JWT to paste into the web app or curl.
 *
 *   npm run seed
 */

const TENANT = "demo-tenant";
const USER = "demo-user";

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

async function main() {
  await connectMongo();

  await Promise.all([
    User.deleteMany({ tenantId: TENANT }),
    Sop.deleteMany({ tenantId: TENANT }),
    Ticket.deleteMany({ tenantId: TENANT }),
  ]);

  await User.create({ tenantId: TENANT, email: "demo@example.com", role: "admin" });

  for (const sop of SOPS) {
    const embedding = await embed(sop.text);
    await Sop.create({ ...sop, tenantId: TENANT, embedding });
  }
  await Ticket.insertMany(TICKETS.map((t) => ({ ...t, tenantId: TENANT })));

  const token = signDevToken(TENANT, USER, "admin");
  console.log("\n✅ Seeded demo tenant.");
  console.log(`   SOPs: ${SOPS.length}  Tickets: ${TICKETS.length}`);
  console.log("\n🔑 Dev JWT (12h):\n");
  console.log(token);
  console.log("\nTry it:\n");
  console.log(`  curl -s localhost:4000/api/sops/search?q=failover -H "authorization: Bearer ${token.slice(0, 12)}..."\n`);

  await disconnectMongo();
}

main().catch((err) => {
  console.error("[seed] failed", err);
  process.exit(1);
});

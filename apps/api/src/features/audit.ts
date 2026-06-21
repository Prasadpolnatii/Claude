import { config } from "../config.js";
import { RedactionAudit } from "../models/index.js";

/**
 * Audit + budget guardrails.
 *  - Every redaction pass is logged (compliance: prove PII was scrubbed).
 *  - Per-tenant daily token spend is metered; over budget → `budget_exceeded`.
 *
 * The token meter is in-memory here for the scaffold; back it with Redis
 * (INCRBY + daily-expiring key) for a real multi-instance deployment.
 */

const dailyTokens = new Map<string, { day: string; used: number }>();

export function recordRedaction(tenantId: string, jobId: string, hits: Record<string, number>): void {
  // Fire-and-forget; never block the LLM path on the audit write, but log failures.
  void RedactionAudit.create({ tenantId, jobId, hits }).catch((err) =>
    console.error("[audit] failed to write redaction log", err),
  );
}

export function recordTokens(tenantId: string, tokens: number): void {
  const day = new Date().toISOString().slice(0, 10);
  const cur = dailyTokens.get(tenantId);
  if (!cur || cur.day !== day) {
    dailyTokens.set(tenantId, { day, used: tokens });
  } else {
    cur.used += tokens;
  }
}

export function isOverBudget(tenantId: string): boolean {
  const cur = dailyTokens.get(tenantId);
  if (!cur || cur.day !== new Date().toISOString().slice(0, 10)) return false;
  return cur.used >= config.TENANT_DAILY_TOKEN_BUDGET;
}

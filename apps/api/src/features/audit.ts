import { config } from "../config.js";
import { AuditLog, RedactionAudit } from "../models/index.js";
import { isMongoConnected } from "../db/mongo.js";
import { redis } from "./redisStore.js";

/**
 * Operational audit trail — records who did what (incident ack/resolve, alert
 * resolution, knowledge edits). Distinct from the redaction audit below, which
 * is a compliance proof that PII was scrubbed. Degrades quietly when Mongo is
 * down: the action still happened, only the audit row is skipped.
 */
export function recordAudit(input: {
  tenantId: string;
  actor: string;
  role?: string;
  action: string;
  target?: string;
  meta?: Record<string, unknown>;
}): void {
  if (!isMongoConnected()) {
    console.warn(`[audit] mongo down — audit row skipped for action ${input.action}`);
    return;
  }
  void AuditLog.create({
    tenantId: input.tenantId,
    actor: input.actor,
    role: input.role ?? "",
    action: input.action,
    target: input.target ?? "",
    meta: input.meta,
    at: new Date(),
  }).catch((err) => console.error("[audit] failed to write audit log", err));
}

/**
 * Audit + budget guardrails.
 *  - Every redaction pass is logged (compliance: prove PII was scrubbed).
 *  - Per-tenant daily token spend is metered in Redis, so the limit is shared
 *    across API + all worker processes (the in-memory version was per-process).
 *
 * Model: check-before-spend (the worker rejects a job when the tenant is already
 * over budget) + record-after (actual token cost is only known post-call). True
 * pre-reservation would require estimating tokens up front; this is the pragmatic
 * shared meter. Fails open on Redis errors — a metering blip must not block work.
 */

const budgetKey = (tenantId: string) => `budget:${tenantId}:${new Date().toISOString().slice(0, 10)}`;
const BUDGET_TTL_SECONDS = 60 * 60 * 48; // keep a day's counter ~2 days

export function recordRedaction(tenantId: string, jobId: string, hits: Record<string, number>): void {
  // Degrade quietly when Mongo is down (e.g. no-DB mock demos): the redaction
  // still happened and protected the data — only the audit row is skipped.
  if (!isMongoConnected()) {
    console.warn(`[audit] mongo down — redaction audit row skipped for job ${jobId}`);
    return;
  }
  void RedactionAudit.create({ tenantId, jobId, hits }).catch((err) =>
    console.error("[audit] failed to write redaction log", err),
  );
}

/** Increment the tenant's daily token counter (shared, in Redis). */
export async function recordTokens(tenantId: string, tokens: number): Promise<void> {
  if (tokens <= 0) return;
  try {
    const key = budgetKey(tenantId);
    await redis.incrby(key, tokens);
    await redis.expire(key, BUDGET_TTL_SECONDS);
  } catch (err) {
    console.warn("[budget] failed to record tokens", err);
  }
}

/** True when the tenant has already spent its daily budget. Fails open. */
export async function isOverBudget(tenantId: string): Promise<boolean> {
  try {
    const used = Number((await redis.get(budgetKey(tenantId))) ?? 0);
    return used >= config.TENANT_DAILY_TOKEN_BUDGET;
  } catch (err) {
    console.warn("[budget] meter unavailable, allowing request", err);
    return false;
  }
}

import type { Request, RequestHandler } from "express";
import type { ApiErrorBody } from "@ops-copilot/shared";
import { redis } from "../features/redisStore.js";

/**
 * Fixed-window rate limiter backed by Redis (INCR + EXPIRE), so the limit is
 * shared across the API and all worker/replica processes.
 *
 * Keyed by tenant when authenticated (so one tenant can't starve another), else
 * by client IP (protects unauthenticated endpoints from floods). Fails OPEN on a
 * Redis error — a limiter outage must not take down the API.
 */
export interface RateLimitOptions {
  windowSec: number;
  max: number;
  /** Namespaces the counter so different limiters don't collide. */
  keyPrefix: string;
}

function clientKey(req: Request): string {
  if (req.auth?.tenantId) return `t:${req.auth.tenantId}`;
  return `ip:${req.ip ?? "unknown"}`;
}

export function rateLimit({ windowSec, max, keyPrefix }: RateLimitOptions): RequestHandler {
  return async (req, res: import("express").Response<ApiErrorBody>, next): Promise<void> => {
    const window = Math.floor(Date.now() / 1000 / windowSec);
    const key = `rl:${keyPrefix}:${clientKey(req)}:${window}`;
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSec);

      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - count)));

      if (count > max) {
        res.setHeader("Retry-After", String(windowSec));
        res.status(429).json({
          error: { code: "rate_limited", message: `Rate limit exceeded: ${max} requests per ${windowSec}s.`, retryable: true },
        });
        return;
      }
      next();
    } catch (err) {
      console.warn("[ratelimit] unavailable, allowing request", err);
      next();
    }
  };
}

/** Strict limiter for expensive generative endpoints (per tenant). */
export const generativeLimiter = rateLimit({ windowSec: 60, max: 30, keyPrefix: "gen" });

/** Generous global limiter (per IP) as a flood guard for the whole API. */
export const globalLimiter = rateLimit({ windowSec: 60, max: 300, keyPrefix: "api" });

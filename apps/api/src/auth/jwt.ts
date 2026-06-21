import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { ApiErrorBody } from "@ops-copilot/shared";
import { config } from "../config.js";

/**
 * Multi-tenant auth. The JWT carries `tenantId` + `sub` (user id). Every request
 * is scoped to its tenant; handlers read `req.auth.tenantId` and pass it down so
 * no query can cross tenant boundaries.
 */

export interface AuthContext {
  tenantId: string;
  userId: string;
  role: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const unauthorized = (res: Response<ApiErrorBody>, message: string) =>
  res.status(401).json({ error: { code: "unauthorized", message, retryable: false } });

/** Header-only bearer auth for normal API requests. */
export function requireAuth(req: Request, res: Response<ApiErrorBody>, next: NextFunction): void {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    unauthorized(res, "Missing bearer token.");
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), config.JWT_SECRET, {
      issuer: config.JWT_ISSUER,
      algorithms: ["HS256"], // pin: don't honor the alg the token claims
    }) as jwt.JwtPayload;

    if (!payload.tenantId || !payload.sub) {
      unauthorized(res, "Token missing tenantId/sub.");
      return;
    }
    req.auth = {
      tenantId: String(payload.tenantId),
      userId: String(payload.sub),
      role: String(payload.role ?? "engineer"),
    };
    next();
  } catch {
    unauthorized(res, "Invalid or expired token.");
  }
}

/**
 * SSE auth. EventSource can't send an Authorization header, so the stream route
 * takes a short-lived (60s), single-purpose token scoped to ONE job id in the
 * query string. Far safer than putting the 12h session JWT in a URL (which lands
 * in logs/history): a leaked stream token expires in a minute and only unlocks
 * that one job's stream.
 */
export function signStreamToken(tenantId: string, jobId: string): string {
  return jwt.sign({ tenantId, jobId, purpose: "sse" }, config.JWT_SECRET, {
    issuer: config.JWT_ISSUER,
    algorithm: "HS256",
    expiresIn: "60s",
  });
}

export function requireStreamToken(req: Request, res: Response<ApiErrorBody>, next: NextFunction): void {
  const token = typeof req.query.t === "string" ? req.query.t : undefined;
  if (!token) {
    unauthorized(res, "Missing stream token.");
    return;
  }
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, {
      issuer: config.JWT_ISSUER,
      algorithms: ["HS256"],
    }) as jwt.JwtPayload;

    if (payload.purpose !== "sse" || !payload.tenantId || !payload.jobId) {
      unauthorized(res, "Not a stream token.");
      return;
    }
    // Bind the token to the job id in the path — one token can't stream another job.
    if (String(payload.jobId) !== req.params.id) {
      res.status(403).json({ error: { code: "forbidden", message: "Stream token job mismatch.", retryable: false } });
      return;
    }
    req.auth = { tenantId: String(payload.tenantId), userId: "sse", role: "sse" };
    next();
  } catch {
    unauthorized(res, "Invalid or expired stream token.");
  }
}

/** Dev helper — mint a token for the seeded tenant. Never expose in prod. */
export function signDevToken(tenantId: string, userId: string, role = "engineer"): string {
  return jwt.sign({ tenantId, role }, config.JWT_SECRET, {
    subject: userId,
    issuer: config.JWT_ISSUER,
    expiresIn: "12h",
  });
}

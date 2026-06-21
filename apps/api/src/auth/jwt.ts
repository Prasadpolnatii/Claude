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

export function requireAuth(req: Request, res: Response<ApiErrorBody>, next: NextFunction): void {
  // EventSource (SSE) can't set headers, so the stream route passes the token as
  // `?access_token=`. Accept either. In production, prefer a short-lived signed
  // stream URL over a long-lived token in the query string.
  const header = req.header("authorization");
  const queryToken = typeof req.query.access_token === "string" ? req.query.access_token : undefined;
  const raw = header?.startsWith("Bearer ") ? header.slice(7) : queryToken;
  if (!raw) {
    res.status(401).json({ error: { code: "unauthorized", message: "Missing bearer token.", retryable: false } });
    return;
  }
  try {
    const payload = jwt.verify(raw, config.JWT_SECRET, {
      issuer: config.JWT_ISSUER,
    }) as jwt.JwtPayload;

    if (!payload.tenantId || !payload.sub) {
      res.status(401).json({ error: { code: "unauthorized", message: "Token missing tenantId/sub.", retryable: false } });
      return;
    }
    req.auth = {
      tenantId: String(payload.tenantId),
      userId: String(payload.sub),
      role: String(payload.role ?? "engineer"),
    };
    next();
  } catch {
    res.status(401).json({ error: { code: "unauthorized", message: "Invalid or expired token.", retryable: false } });
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

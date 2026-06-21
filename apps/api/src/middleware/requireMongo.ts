import type { NextFunction, Request, Response } from "express";
import type { ApiErrorBody } from "@ops-copilot/shared";
import { connectMongo } from "../db/mongo.js";

/**
 * Gate for routes that need MongoDB (tickets, SOPs). Lazily connects on first
 * request; if the DB is unreachable, returns a clean 503 instead of letting the
 * handler hang or throw. The rest of the API (health, jobs) never hits this.
 */
export async function requireMongo(
  _req: Request,
  res: Response<ApiErrorBody>,
  next: NextFunction,
): Promise<void> {
  try {
    await connectMongo();
    next();
  } catch {
    res.status(503).json({
      error: {
        code: "db_unavailable",
        message:
          "Database unavailable. Ticket and SOP features need MongoDB; health and job endpoints work without it.",
        retryable: true,
      },
    });
  }
}

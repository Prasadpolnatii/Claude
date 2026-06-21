import type { NextFunction, Request, Response } from "express";
import type { ApiError, ApiErrorBody } from "@ops-copilot/shared";

/**
 * Uniform error envelope (DX-review decision). Every error leaves the API as
 * `{ error: { code, message, retryable } }` so the web app can branch on
 * `retryable` instead of parsing prose.
 */

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: ApiError,
  ) {
    super(body.message);
  }
}

export function notFound(_req: Request, res: Response<ApiErrorBody>): void {
  res.status(404).json({ error: { code: "not_found", message: "Resource not found.", retryable: false } });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response<ApiErrorBody>,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.body });
    return;
  }
  console.error("[error] unhandled", err);
  res.status(500).json({ error: { code: "internal", message: "Unexpected server error.", retryable: true } });
}

export const badRequest = (message: string) =>
  new HttpError(400, { code: "bad_request", message, retryable: false });

/**
 * Wrap async route handlers so a rejected promise reaches `errorHandler` instead
 * of crashing the process. Express 4 does not catch async errors on its own.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

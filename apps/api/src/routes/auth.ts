import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { signDevToken } from "../auth/jwt.js";
import { asyncHandler, HttpError } from "../middleware/error.js";

export const authRouter = Router();

/**
 * Demo login — gated behind ENABLE_DEV_LOGIN. Mints a 12h tenant JWT for the
 * demo tenant so a public demo is usable from a phone without copying a token
 * from server logs. Returns 404 when disabled.
 *
 * ⚠️ This issues admin tokens to any caller. It exists ONLY for the seeded demo
 * tenant and MUST stay off in any real multi-user deployment.
 */
const schema = z.object({ role: z.enum(["admin", "engineer"]).default("admin") });

authRouter.post(
  "/dev-login",
  asyncHandler(async (req: Request, res: Response) => {
    if (!config.ENABLE_DEV_LOGIN) {
      throw new HttpError(404, { code: "not_found", message: "Resource not found.", retryable: false });
    }
    const parsed = schema.safeParse(req.body ?? {});
    const role = parsed.success ? parsed.data.role : "admin";
    const tenantId = config.ALERTS_SIMULATE_TENANT; // the seeded demo tenant
    const userId = `demo-${role}`;
    res.json({ token: signDevToken(tenantId, userId, role), role, tenantId });
  }),
);

/** GET /api/auth/config — lets the web app know whether to show demo-login buttons. */
authRouter.get("/config", (_req: Request, res: Response) => {
  res.json({ devLogin: config.ENABLE_DEV_LOGIN });
});

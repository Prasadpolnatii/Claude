import { Router, type Request, type Response } from "express";
import { Application } from "../models/index.js";
import { serializeApplication } from "../features/serialize.js";
import { asyncHandler } from "../middleware/error.js";

export const applicationsRouter = Router();

/** GET /api/applications — health snapshot for every monitored service. */
applicationsRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const docs = await Application.find({ tenantId: req.auth!.tenantId }).sort({ name: 1 });
    res.json({ applications: docs.map(serializeApplication) });
  }),
);

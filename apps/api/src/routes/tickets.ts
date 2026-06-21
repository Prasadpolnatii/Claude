import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Ticket } from "../models/index.js";
import { asyncHandler, badRequest } from "../middleware/error.js";

export const ticketsRouter = Router();

/** GET /api/tickets — tenant-scoped inbox. */
ticketsRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const tickets = await Ticket.find({ tenantId: req.auth!.tenantId }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ tickets });
}));

const createSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  externalId: z.string().optional(),
});

/** POST /api/tickets — ingest a ticket. */
ticketsRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  const ticket = await Ticket.create({ ...parsed.data, tenantId: req.auth!.tenantId });
  res.status(201).json({ ticket });
}));

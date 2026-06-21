import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { Sop } from "../models/index.js";
import { embed } from "../llm/client.js";
import { searchSops } from "../features/sopStore.js";
import { asyncHandler, badRequest } from "../middleware/error.js";

export const sopsRouter = Router();

/** GET /api/sops/search?q=... — synchronous retrieval (no LLM, fast). */
sopsRouter.get("/search", asyncHandler(async (req: Request, res: Response) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) throw badRequest("query param `q` is required");
  const hits = await searchSops(req.auth!.tenantId, q, 8);
  res.json({ hits });
}));

const upsertSchema = z.object({
  title: z.string().min(1),
  section: z.string().optional(),
  text: z.string().min(1),
});

/** POST /api/sops — add/index a runbook section (embeds on write). */
sopsRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  const embedding = await embed(parsed.data.text);
  const sop = await Sop.create({ ...parsed.data, embedding, tenantId: req.auth!.tenantId });
  res.status(201).json({ sop: { id: sop._id, title: sop.title } });
}));

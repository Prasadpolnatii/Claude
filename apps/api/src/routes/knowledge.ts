import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Knowledge } from "../models/index.js";
import { serializeKnowledge } from "../features/serialize.js";
import { recordAudit } from "../features/audit.js";
import { asyncHandler, badRequest, HttpError } from "../middleware/error.js";
import { requireRole } from "../auth/jwt.js";

export const knowledgeRouter = Router();

const notFound = () => new HttpError(404, { code: "not_found", message: "Article not found.", retryable: false });

/**
 * GET /api/knowledge — list articles (metadata + body; the corpus is small).
 *   ?q=term  full-text-ish filter over title/body  ?category=...
 */
knowledgeRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const filter: Record<string, unknown> = { tenantId: req.auth!.tenantId };
    if (typeof req.query.category === "string" && req.query.category.trim()) {
      filter.category = req.query.category.trim();
    }
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ title: rx }, { body: rx }, { tags: rx }];
    }
    const docs = await Knowledge.find(filter).sort({ updatedAt: -1 }).limit(200);
    res.json({ articles: docs.map(serializeKnowledge) });
  }),
);

/** GET /api/knowledge/:id — single article for the viewer. */
knowledgeRouter.get(
  "/:id",
  asyncHandler(async (req: Request, res: Response) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound();
    const doc = await Knowledge.findOne({ _id: req.params.id, tenantId: req.auth!.tenantId });
    if (!doc) throw notFound();
    res.json({ article: serializeKnowledge(doc) });
  }),
);

const upsertSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.string().trim().max(60).optional(),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
  body: z.string().trim().min(1).max(50_000),
});

/** POST /api/knowledge — create an article (admin only; audited). */
knowledgeRouter.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => i.message).join("; "));
    const { tenantId, userId, role } = req.auth!;
    const doc = await Knowledge.create({
      tenantId,
      title: parsed.data.title,
      category: parsed.data.category ?? "general",
      tags: parsed.data.tags ?? [],
      body: parsed.data.body,
    });
    recordAudit({ tenantId, actor: userId, role, action: "knowledge.create", target: String(doc._id), meta: { title: parsed.data.title } });
    res.status(201).json({ article: serializeKnowledge(doc) });
  }),
);

/** PUT /api/knowledge/:id — edit an article (admin only; audited). */
knowledgeRouter.put(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req: Request, res: Response) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound();
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => i.message).join("; "));
    const { tenantId, userId, role } = req.auth!;
    const doc = await Knowledge.findOne({ _id: req.params.id, tenantId });
    if (!doc) throw notFound();

    doc.title = parsed.data.title;
    doc.category = parsed.data.category ?? "general";
    doc.tags = parsed.data.tags ?? [];
    doc.body = parsed.data.body;
    await doc.save();
    recordAudit({ tenantId, actor: userId, role, action: "knowledge.update", target: String(doc._id) });
    res.json({ article: serializeKnowledge(doc) });
  }),
);

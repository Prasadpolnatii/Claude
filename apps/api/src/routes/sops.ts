import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import type { JobType } from "@ops-copilot/shared";
import { addSopChunks, searchSops } from "../features/sopStore.js";
import { chunkText } from "../features/chunker.js";
import { extractText } from "../features/docExtract.js";
import { generativeQueue } from "../queue/queue.js";
import { generativeLimiter } from "../middleware/rateLimit.js";
import { asyncHandler, badRequest } from "../middleware/error.js";

export const sopsRouter = Router();

// In-memory upload (≤10 MB); we read the buffer, extract text, then discard it.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * POST /api/sops/upload — upload a runbook (PDF / .md / .txt). The server
 * extracts text, chunks it, embeds each chunk, and stores the vectors (Atlas
 * Vector Search when Mongo is up; Redis-backed store in mock mode).
 *
 * multipart/form-data: `file` (required), `title` (optional override).
 */
sopsRouter.post("/upload", generativeLimiter, upload.single("file"), asyncHandler(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) throw badRequest("multipart field `file` is required");

  const text = await extractText(file);
  if (!text) throw badRequest("no extractable text in the uploaded document");

  const title = (req.body?.title as string)?.trim() || file.originalname;
  const chunks = chunkText(text);
  const stored = await addSopChunks(req.auth!.tenantId, title, chunks);

  res.status(201).json({ document: title, chunks: stored, characters: text.length });
}));

/**
 * POST /api/sops/search — grounded answer. Enqueues a sop_search job (async, per
 * the no-LLM-in-handlers rule) and returns a jobId; the client streams the
 * answer + citations + confidence via GET /api/jobs/:id/stream.
 */
const searchSchema = z.object({ query: z.string().trim().min(1).max(1000) });
sopsRouter.post("/search", generativeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => i.message).join("; "));

  const tenantId = req.auth!.tenantId;
  const job = await generativeQueue.add(
    "sop_search",
    { tenantId, type: "sop_search" as JobType, input: { query: parsed.data.query } },
    { removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 }, attempts: 2, backoff: { type: "exponential", delay: 2000 } },
  );
  res.status(202).json({ jobId: job.id });
}));

/** GET /api/sops/search?q=... — fast raw retrieval (no LLM), for instant hits. */
sopsRouter.get("/search", asyncHandler(async (req: Request, res: Response) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) throw badRequest("query param `q` is required");
  const hits = await searchSops(req.auth!.tenantId, q, 8);
  res.json({ hits });
}));

/** POST /api/sops — add a single runbook section directly (no file). */
const upsertSchema = z.object({ title: z.string().min(1), text: z.string().min(1) });
sopsRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest(parsed.error.issues.map((i) => i.message).join("; "));
  const stored = await addSopChunks(req.auth!.tenantId, parsed.data.title, chunkText(parsed.data.text));
  res.status(201).json({ document: parsed.data.title, chunks: stored });
}));

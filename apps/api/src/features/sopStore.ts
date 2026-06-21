import { config } from "../config.js";
import { Sop } from "../models/index.js";
import { embed } from "../llm/client.js";
import { redact } from "../llm/redaction.js";
import { isMongoConnected } from "../db/mongo.js";
import { mockStore } from "./redisStore.js";
import type { Chunk } from "./chunker.js";
import { clamp01, cosineRank } from "./vectorMath.js";

/**
 * SOP retrieval, dual-mode:
 *  - MongoDB Atlas Vector Search ($vectorSearch) when Mongo is connected, with a
 *    cosine fallback for plain local Mongo (no Atlas).
 *  - A Redis-backed store when Mongo is down (mock mode). Redis is shared across
 *    the API (which uploads) and the worker (which searches), so the full
 *    upload → search flow works with no database. Embeddings come from the mock
 *    embedder, so mock mode is fully self-contained.
 */

export interface SopHit {
  id: string;
  title: string;
  text: string;
  /** Similarity in [0,1] used for grounding/confidence. */
  score: number;
}

interface StoredChunk {
  id: string;
  title: string;
  text: string;
  embedding: number[];
}

const memKey = (tenantId: string) => `sops:mock:${tenantId}`;
const MEM_TTL_SECONDS = 60 * 60 * 24; // mock store self-expires after a day

/** Embed + persist document chunks. Returns the number stored. */
export async function addSopChunks(
  tenantId: string,
  title: string,
  chunks: Chunk[],
): Promise<number> {
  if (chunks.length === 0) return 0;

  const embedded = await Promise.all(
    chunks.map(async (c) => ({
      title,
      section: String(c.index),
      text: c.text,
      embedding: await embed(c.text),
    })),
  );

  if (isMongoConnected()) {
    await Sop.insertMany(embedded.map((c) => ({ ...c, tenantId })));
  } else {
    const items = embedded.map(
      (c, i): StoredChunk => ({ id: `mem-${Date.now()}-${i}`, title: c.title, text: c.text, embedding: c.embedding }),
    );
    await mockStore.rpush(memKey(tenantId), ...items.map((i) => JSON.stringify(i)));
    await mockStore.expire(memKey(tenantId), MEM_TTL_SECONDS);
  }
  return embedded.length;
}

export async function searchSops(tenantId: string, query: string, k = 5): Promise<SopHit[]> {
  // Redact before embedding: embed() is an OpenAI call, and the raw query (e.g.
  // from GET /sops/search) may carry PII. Idempotent on the already-redacted
  // text the orchestrator passes. (SOP *content* is the trusted knowledge base
  // and is intentionally embedded as-is.)
  const queryVec = await embed(redact(query).text);

  if (isMongoConnected()) {
    // Atlas Vector Search first.
    try {
      const docs = await Sop.aggregate([
        {
          $vectorSearch: {
            index: config.VECTOR_INDEX_NAME,
            path: "embedding",
            queryVector: queryVec,
            numCandidates: Math.max(50, k * 10),
            limit: k,
            filter: { tenantId },
          },
        },
        { $project: { title: 1, text: 1, score: { $meta: "vectorSearchScore" } } },
      ]);
      if (docs.length) {
        return docs.map((d) => ({ id: String(d._id), title: d.title, text: d.text, score: clamp01(d.score) }));
      }
    } catch {
      // $vectorSearch unavailable (non-Atlas local Mongo) — fall through.
    }
    const all = await Sop.find({ tenantId }).lean();
    return cosineRank(
      all.map((d) => ({ id: String(d._id), title: d.title as string, text: d.text as string, embedding: (d.embedding as number[]) ?? [] })),
      queryVec,
      k,
    );
  }

  // Mock mode: Redis-backed store.
  const raw = await mockStore.lrange(memKey(tenantId), 0, -1);
  const stored: StoredChunk[] = raw.map((r) => JSON.parse(r));
  return cosineRank(stored, queryVec, k);
}

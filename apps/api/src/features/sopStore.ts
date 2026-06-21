import { config } from "../config.js";
import { Sop } from "../models/index.js";
import { embed } from "../llm/client.js";

/**
 * SOP retrieval. In production this uses MongoDB Atlas Vector Search ($vectorSearch).
 * Locally (plain Mongo, no Atlas) we fall back to in-memory cosine similarity so
 * the flow works without Atlas — controlled by whether $vectorSearch is available.
 *
 * Vector-store decision (taste T1): reuse MongoDB rather than add Pinecone/Chroma.
 */

export interface SopHit {
  id: string;
  title: string;
  text: string;
  /** Similarity score in [0,1] used for the grounding/confidence calc. */
  score: number;
}

export async function searchSops(tenantId: string, query: string, k = 5): Promise<SopHit[]> {
  const queryVec = await embed(query);

  // Try Atlas Vector Search first.
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
      return docs.map((d) => ({
        id: String(d._id),
        title: d.title,
        text: d.text,
        score: clamp(d.score),
      }));
    }
  } catch {
    // $vectorSearch unavailable (non-Atlas local Mongo). Fall through.
  }

  return inMemorySearch(tenantId, queryVec, k);
}

async function inMemorySearch(tenantId: string, queryVec: number[], k: number): Promise<SopHit[]> {
  const docs = await Sop.find({ tenantId }).lean();
  return docs
    .map((d) => ({
      id: String(d._id),
      title: d.title as string,
      text: d.text as string,
      score: clamp(cosine(queryVec, (d.embedding as number[]) ?? [])),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));

import { config } from "../config.js";
import { Sop, Summary, User } from "../models/index.js";

/**
 * Index bootstrap for a real MongoDB deployment.
 *
 *  - ensureCollectionIndexes(): builds the schema indexes (unique constraints
 *    the upserts rely on). Idempotent; safe to call on every boot. Prefer this
 *    over mongoose autoIndex in production (autoIndex is racy with lazy connect
 *    and silent on failure).
 *  - ensureVectorSearchIndex(): creates the Atlas Vector Search index on
 *    sops.embedding. Atlas-only — a clear no-op with guidance on plain MongoDB.
 */

export async function ensureCollectionIndexes(): Promise<void> {
  // createIndexes() resolves once the unique/compound indexes exist.
  await Promise.all([
    User.createIndexes(),
    Summary.createIndexes(), // unique (tenantId, ticketId) — one summary per ticket
    Sop.createIndexes(),
  ]);
  console.log("[mongo] collection indexes ensured");
}

/**
 * Atlas Vector Search index definition for sops.embedding. Mirrors
 * apps/api/atlas/sop_vector_index.json. tenantId is a filter field so
 * $vectorSearch can scope by tenant.
 */
export const SOP_VECTOR_INDEX_DEFINITION = {
  name: config.VECTOR_INDEX_NAME,
  type: "vectorSearch",
  definition: {
    fields: [
      { type: "vector", path: "embedding", numDimensions: config.EMBEDDING_DIMENSIONS, similarity: "cosine" },
      { type: "filter", path: "tenantId" },
    ],
  },
} as const;

export async function ensureVectorSearchIndex(): Promise<"created" | "exists" | "unsupported"> {
  const coll = Sop.collection;
  try {
    const existing = await coll.listSearchIndexes().toArray();
    if (existing.some((i: { name?: string }) => i.name === config.VECTOR_INDEX_NAME)) {
      return "exists";
    }
    await coll.createSearchIndex(SOP_VECTOR_INDEX_DEFINITION);
    console.log(`[mongo] created Atlas Vector Search index "${config.VECTOR_INDEX_NAME}"`);
    return "created";
  } catch (err) {
    // Plain MongoDB (non-Atlas) doesn't support search indexes — the code falls
    // back to in-memory cosine over Sop.find(), so this is non-fatal.
    console.warn(
      `[mongo] vector search index unavailable (non-Atlas?). Falling back to cosine retrieval. (${(err as Error).message})`,
    );
    return "unsupported";
  }
}

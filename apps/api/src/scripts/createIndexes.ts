import { connectMongo, disconnectMongo } from "../db/mongo.js";
import { ensureCollectionIndexes, ensureVectorSearchIndex } from "../db/indexes.js";

/**
 * One-shot index creation against the configured MONGODB_URI.
 *   npm run -w @ops-copilot/api db:indexes
 * Builds collection indexes everywhere; creates the Atlas Vector Search index
 * when pointed at Atlas (no-op with guidance on plain MongoDB).
 */
async function main() {
  await connectMongo();
  await ensureCollectionIndexes();
  const vector = await ensureVectorSearchIndex();
  console.log(`[indexes] vector search index: ${vector}`);
  await disconnectMongo();
  process.exit(0);
}

main().catch((err) => {
  console.error("[indexes] failed", err);
  process.exit(1);
});

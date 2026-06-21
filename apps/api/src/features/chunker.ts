/**
 * Document chunking for retrieval. Splits text into overlapping windows so each
 * embedded chunk is small enough to be a precise retrieval unit, while the
 * overlap preserves context across boundaries.
 *
 * Pure and dependency-free so it can be unit-tested in isolation.
 */

export interface Chunk {
  text: string;
  index: number;
}

export interface ChunkOptions {
  /** Target max characters per chunk. */
  size?: number;
  /** Characters of trailing context carried into the next chunk. */
  overlap?: number;
}

export function chunkText(input: string, opts: ChunkOptions = {}): Chunk[] {
  const size = opts.size ?? 1000;
  const overlap = Math.min(opts.overlap ?? 150, Math.floor(size / 2));

  const clean = input.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];

  const paragraphs = clean.split(/\n\n+/);
  const chunks: string[] = [];
  let cur = "";

  const flush = () => {
    const trimmed = cur.trim();
    if (trimmed) chunks.push(trimmed);
    // Carry the overlap tail into the next window.
    cur = overlap > 0 && trimmed.length > overlap ? trimmed.slice(trimmed.length - overlap) + "\n\n" : "";
  };

  for (const para of paragraphs) {
    if (para.length > size) {
      // A single oversized paragraph: hard-split with overlap.
      if (cur.trim()) flush();
      const step = size - overlap;
      for (let i = 0; i < para.length; i += step) {
        chunks.push(para.slice(i, i + size).trim());
      }
      cur = "";
      continue;
    }
    if (cur.length + para.length + 2 > size && cur.trim()) {
      flush();
    }
    cur += para + "\n\n";
  }
  if (cur.trim()) chunks.push(cur.trim());

  return chunks
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((text, index) => ({ text, index }));
}

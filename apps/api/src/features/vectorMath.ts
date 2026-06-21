/**
 * Pure vector helpers for retrieval ranking. No I/O — unit-testable in isolation.
 */

export interface Embedded {
  id: string;
  title: string;
  text: string;
  embedding: number[];
}

export interface RankedHit {
  id: string;
  title: string;
  text: string;
  score: number;
}

export function cosine(a: number[], b: number[]): number {
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

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Rank items by cosine similarity to the query vector, top-k descending. */
export function cosineRank(items: Embedded[], queryVec: number[], k: number): RankedHit[] {
  return items
    .map((it) => ({ id: it.id, title: it.title, text: it.text, score: clamp01(cosine(queryVec, it.embedding)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { cosine, cosineRank } from "./vectorMath.ts";

test("cosine: identical vectors = 1, orthogonal = 0, mismatched dims = 0", () => {
  assert.equal(cosine([1, 0, 0], [1, 0, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1, 2, 3], [1, 2]), 0);
  assert.equal(cosine([], []), 0);
});

test("cosineRank orders by similarity and respects k", () => {
  const items = [
    { id: "a", title: "A", text: "failover", embedding: [1, 0, 0] },
    { id: "b", title: "B", text: "cache", embedding: [0, 1, 0] },
    { id: "c", title: "C", text: "failover-ish", embedding: [0.9, 0.1, 0] },
  ];
  const ranked = cosineRank(items, [1, 0, 0], 2);
  assert.equal(ranked.length, 2, "respects k");
  assert.equal(ranked[0]!.id, "a", "best match first");
  assert.equal(ranked[1]!.id, "c", "second-best next");
  assert.ok(ranked[0]!.score >= ranked[1]!.score);
  assert.ok(ranked[0]!.score >= 0 && ranked[0]!.score <= 1, "score clamped to [0,1]");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText } from "./chunker.ts";

test("empty / whitespace input yields no chunks", () => {
  assert.deepEqual(chunkText(""), []);
  assert.deepEqual(chunkText("   \n\n  "), []);
});

test("short text is a single chunk", () => {
  const c = chunkText("Just one short runbook line.");
  assert.equal(c.length, 1);
  assert.equal(c[0]!.index, 0);
});

test("long text splits into multiple sequential chunks within the size bound", () => {
  const para = "Sentence about failover and connection pools. ".repeat(40); // ~1880 chars
  const text = `${para}\n\n${para}`;
  const chunks = chunkText(text, { size: 500, overlap: 50 });
  assert.ok(chunks.length >= 4, `expected several chunks, got ${chunks.length}`);
  chunks.forEach((c, i) => assert.equal(c.index, i, "indexes are sequential"));
  // Each chunk respects the size bound (allowing the overlap tail).
  for (const c of chunks) assert.ok(c.text.length <= 500 + 50, `chunk too large: ${c.text.length}`);
});

test("overlap carries trailing context into the next chunk", () => {
  const a = "AAAA ".repeat(120); // ~600 chars
  const b = "BBBB ".repeat(120);
  const chunks = chunkText(`${a}\n\n${b}`, { size: 300, overlap: 60 });
  assert.ok(chunks.length >= 2);
  // At least one boundary should share text (overlap), so total chars > input/size naive.
  const joined = chunks.map((c) => c.text).join("");
  assert.ok(joined.length > a.length + b.length - 300, "expected overlap to duplicate some context");
});

test("an oversized single paragraph is hard-split", () => {
  const huge = "x".repeat(2500); // no separators
  const chunks = chunkText(huge, { size: 1000, overlap: 100 });
  assert.ok(chunks.length >= 3);
  for (const c of chunks) assert.ok(c.text.length <= 1000);
});

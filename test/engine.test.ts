/**
 * Unit tests for the pure search engine — no model download required.
 * Run: npm test   (node --test via tsx)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  tokenize,
  buildKeywordIndex,
  rrfFuse,
  exactTitleMatches,
  resolveTypo,
  DEFAULT_TYPO,
} from "../src/hybrid.js";
import { searchVectors, createSearcher } from "../src/search.js";
import { readProducts, saveIndex, loadIndex } from "../src/storage.js";
import type { PragmaIndex, IndexItem } from "../src/types.js";

const item = (id: string, title: string): IndexItem => ({ id, vector: [], payload: { id, title } });

// ---------- tokenizer / stemmer ----------
test("tokenize: lowercases, drops stopwords, stems plurals", () => {
  const toks = tokenize("The Wireless Headphones for Gaming");
  assert.ok(toks.includes("wireless"));
  assert.ok(toks.includes("headphone")); // plural stemmed
  assert.ok(toks.includes("gaming"));
  assert.ok(!toks.includes("the")); // stopword
  assert.ok(!toks.includes("for"));
});

test("stemmer does not mangle singular -s words", () => {
  assert.deepEqual(tokenize("analysis"), ["analysis"]);
  assert.deepEqual(tokenize("wireless"), ["wireless"]);
  assert.deepEqual(tokenize("status"), ["status"]);
  assert.deepEqual(tokenize("cards"), ["card"]); // genuine plural still stemmed
});

// ---------- BM25 keyword layer ----------
test("buildKeywordIndex ranks the matching product first", () => {
  const kw = buildKeywordIndex([
    item("1", "Wireless Gaming Mouse"),
    item("2", "Coffee Mug"),
    item("3", "Mechanical Keyboard"),
  ]);
  const hits = kw.search("gaming mouse", 5);
  assert.equal(hits[0].id, "1");
});

test("typo tolerance: opple -> apple (on), nothing (off)", () => {
  const kw = buildKeywordIndex([
    item("1", "Apple AirPods Pro"),
    item("2", "Samsung Galaxy"),
  ]);
  const on = kw.search("opple", 5, true);
  assert.ok(on.length >= 1 && on[0].id === "1");
  assert.equal(kw.search("opple", 5, false).length, 0);
});

// ---------- RRF ----------
test("rrfFuse is rank-based and symmetric", () => {
  const fused = rrfFuse([["a", "b"], ["b", "a"]], 60);
  assert.ok(Math.abs((fused.get("a") ?? 0) - (fused.get("b") ?? 0)) < 1e-9);
  const f2 = rrfFuse([["a", "b", "c"], ["a", "x"]], 60);
  assert.ok((f2.get("a") ?? 0) > (f2.get("b") ?? 0));
});

// ---------- exact-title boost ----------
test("exactTitleMatches finds verbatim substrings only", () => {
  const hits = exactTitleMatches("rtx 4070", [
    item("1", "NVIDIA GeForce RTX 4070 Ti"),
    item("2", "AMD Radeon RX 8900"),
  ]);
  assert.ok(hits.has("1"));
  assert.ok(!hits.has("2"));
});

// ---------- typo config ----------
test("resolveTypo normalizes loose options", () => {
  assert.equal(resolveTypo(false).enabled, false);
  assert.equal(resolveTypo(true).penalty, DEFAULT_TYPO.penalty);
  assert.equal(resolveTypo({ penalty: 0.9 }).penalty, 0.9);
});

// ---------- cosine vector search ----------
test("searchVectors ranks by cosine similarity", () => {
  const index: PragmaIndex = {
    meta: { version: 1, model: "m", dtype: "q8", dim: 2, pooling: "mean", normalize: true, count: 3, builtAt: "" },
    items: [
      { id: "a", vector: [1, 0], payload: { id: "a", title: "A" } },
      { id: "b", vector: [0, 1], payload: { id: "b", title: "B" } },
      { id: "c", vector: [0.7071, 0.7071], payload: { id: "c", title: "C" } },
    ],
  };
  const r = searchVectors(index, [1, 0], 3);
  assert.equal(r[0].id, "a");
  assert.equal(r[1].id, "c");
});

test("searchVectors throws on dimension mismatch", () => {
  const index: PragmaIndex = {
    meta: { version: 1, model: "m", dtype: "q8", dim: 2, pooling: "mean", normalize: true, count: 1, builtAt: "" },
    items: [{ id: "a", vector: [1, 0], payload: { id: "a", title: "A" } }],
  };
  assert.throws(() => searchVectors(index, [1, 0, 0], 3), /dim/);
});

// ---------- storage validation + round-trip ----------
test("readProducts rejects missing fields and duplicate ids", async () => {
  const f = join(tmpdir(), `ps-test-${process.pid}.json`);
  await writeFile(f, JSON.stringify([{ id: 1, title: "x" }, { id: "1", title: "y" }]));
  await assert.rejects(() => readProducts(f), /duplicate/);
  await writeFile(f, JSON.stringify([{ title: "no id" }]));
  await assert.rejects(() => readProducts(f), /id, title/);
  await rm(f, { force: true });
});

test("saveIndex/loadIndex round-trip", async () => {
  const f = join(tmpdir(), `ps-idx-${process.pid}.json`);
  const idx: PragmaIndex = {
    meta: { version: 1, model: "m", dtype: "q8", dim: 1, pooling: "mean", normalize: true, count: 1, builtAt: "" },
    items: [{ id: "a", vector: [1], payload: { id: "a", title: "A" } }],
  };
  await saveIndex(f, idx);
  assert.deepEqual(await loadIndex(f), idx);
  await rm(f, { force: true });
});

// ---------- encoder-drift guard (throws before any model download) ----------
test("createSearcher rejects an incompatible index format version", async () => {
  await assert.rejects(
    () => createSearcher({ meta: { version: 999, model: "m", dtype: "q8", dim: 2 }, items: [] } as unknown as PragmaIndex),
    /format/,
  );
});

test("createSearcher rejects an index missing model/dtype", async () => {
  await assert.rejects(
    () => createSearcher({ meta: { version: 1, model: "", dtype: "q8", dim: 2 }, items: [] } as unknown as PragmaIndex),
    /model\/dtype/,
  );
});

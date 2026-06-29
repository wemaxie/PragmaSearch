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
import { matchesFilter, computeFacets } from "../src/facets.js";
import { patchPayload, removeItems, planUpsert, applyUpsert } from "../src/incremental.js";
import { readProducts, saveIndex, loadIndex } from "../src/storage.js";
import type { PragmaIndex, IndexItem, Product } from "../src/types.js";

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

// ---------- filtering ----------
test("matchesFilter: scalar, array OR, numeric range, and AND across fields", () => {
  const p: Product = { id: 1, title: "X", category: "Laptops", price: 900, tags: ["gaming", "rgb"] };
  assert.ok(matchesFilter(p, { category: "Laptops" }));
  assert.ok(!matchesFilter(p, { category: "Phones" }));
  assert.ok(matchesFilter(p, { category: ["Phones", "Laptops"] })); // OR
  assert.ok(matchesFilter(p, { tags: "gaming" })); // array-field membership
  assert.ok(matchesFilter(p, { tags: ["office", "rgb"] })); // array field, OR
  assert.ok(matchesFilter(p, { price: { lte: 1000 } }));
  assert.ok(!matchesFilter(p, { price: { gte: 1000 } }));
  assert.ok(matchesFilter(p, { category: "Laptops", price: { gte: 500, lte: 1000 } })); // AND
  assert.ok(!matchesFilter(p, { category: "Laptops", price: { lte: 500 } }));
});

// ---------- facets ----------
test("computeFacets counts values (incl. array fields), sorted by count then name", () => {
  const items: Product[] = [
    { id: 1, title: "a", category: "Laptops", tags: ["gaming"] },
    { id: 2, title: "b", category: "Laptops", tags: ["gaming", "rgb"] },
    { id: 3, title: "c", category: "Phones", tags: ["rgb"] },
  ];
  const f = computeFacets(items, ["category", "tags"]);
  assert.deepEqual(f.category, [{ value: "Laptops", count: 2 }, { value: "Phones", count: 1 }]);
  assert.deepEqual(f.tags, [{ value: "gaming", count: 2 }, { value: "rgb", count: 2 }]);
});

// ---------- incremental updates ----------
const mkIndex = (items: IndexItem[]): PragmaIndex => ({
  meta: { version: 1, model: "m", dtype: "q8", dim: 1, pooling: "mean", normalize: true, count: items.length, builtAt: "" },
  items,
});

test("patchPayload updates fields without touching vectors; skips unknown ids", () => {
  const idx = mkIndex([
    { id: 1, vector: [0.5], payload: { id: 1, title: "A", price: 100 } },
    { id: 2, vector: [0.7], payload: { id: 2, title: "B", price: 200 } },
  ]);
  const n = patchPayload(idx, [
    { id: 1, fields: { price: 90, stock: 5 } as Partial<Product> },
    { id: 99, fields: { price: 1 } },
  ]);
  assert.equal(n, 1);
  assert.equal(idx.items[0].payload.price, 90);
  assert.equal((idx.items[0].payload as Record<string, unknown>).stock, 5);
  assert.deepEqual(idx.items[0].vector, [0.5]); // vector untouched
  assert.equal(idx.items[1].payload.price, 200);
});

test("removeItems drops by id and updates count", () => {
  const idx = mkIndex([
    { id: "a", vector: [1], payload: { id: "a", title: "A" } },
    { id: "b", vector: [1], payload: { id: "b", title: "B" } },
    { id: "c", vector: [1], payload: { id: "c", title: "C" } },
  ]);
  assert.equal(removeItems(idx, ["b", "x"]), 1);
  assert.deepEqual(idx.items.map((it) => it.id), ["a", "c"]);
  assert.equal(idx.meta.count, 2);
});

test("planUpsert: text-unchanged reuses vector, renamed/new gets re-embedded", () => {
  const idx = mkIndex([
    { id: 1, vector: [0.1], payload: { id: 1, title: "Mouse", price: 50 } },
    { id: 2, vector: [0.2], payload: { id: 2, title: "Keyboard" } },
  ]);
  const { toEmbed, toReuse } = planUpsert(idx, [
    { id: 1, title: "Mouse", price: 40 },     // only price changed → reuse vector
    { id: 2, title: "Mechanical Keyboard" },  // renamed → re-embed
    { id: 3, title: "Monitor" },              // new → embed
  ]);
  assert.deepEqual(toReuse.map((r) => r.product.id), [1]);
  assert.deepEqual(toEmbed.map((p) => p.id), [2, 3]);
});

test("applyUpsert merges embedded + reused and updates count", () => {
  const idx = mkIndex([{ id: 1, vector: [0.1], payload: { id: 1, title: "Mouse", price: 50 } }]);
  const reused = [{ item: idx.items[0], product: { id: 1, title: "Mouse", price: 40 } }];
  const embedded: IndexItem[] = [{ id: 3, vector: [0.9], payload: { id: 3, title: "Monitor" } }];
  const { added, updated } = applyUpsert(idx, embedded, reused);
  assert.equal(added, 1);
  assert.equal(updated, 1);
  assert.equal(idx.items.length, 2);
  assert.equal(idx.items[0].payload.price, 40); // reused item's payload swapped
  assert.equal(idx.meta.count, 2);
});

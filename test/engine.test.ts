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
  makeTokenizer,
  resolveTokenizer,
  TOKENIZER_PRESETS,
  buildKeywordIndex,
  rrfFuse,
  exactTitleMatches,
  resolveTypo,
  DEFAULT_TYPO,
} from "../src/hybrid.js";
import { searchVectors, createSearcher } from "../src/search.js";
import { matchesFilter, computeFacets } from "../src/facets.js";
import { patchPayload, removeItems, planUpsert, applyUpsert } from "../src/incremental.js";
import { resolveSearchable, fieldText, productText, DEFAULT_SEARCHABLE } from "../src/searchable.js";
import { buildSynonyms } from "../src/synonyms.js";
import { applyRankingRules } from "../src/ranking.js";
import { signSearchToken, verifySearchToken, mergeForcedFilter } from "../src/tokens.js";
import { highlightProduct, highlightField, snippetField } from "../src/highlight.js";
import { readProducts, saveIndex, loadIndex } from "../src/storage.js";
import type { PragmaIndex, IndexItem, Product, SearchSignal, Filter } from "../src/types.js";

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

// ---------- tokenizer (language-aware) ----------
test("default tokenizer keeps non-ASCII letters (Unicode split, not [a-z] only)", () => {
  assert.deepEqual(tokenize("Café Müller"), ["café", "müller"]); // previously mangled to ["caf"]
  assert.deepEqual(tokenize("Ноутбук ASUS"), ["ноутбук", "asus"]); // Cyrillic survives
});

test("minimal preset: no stopwords, no stemming (safe for any language)", () => {
  const min = makeTokenizer(TOKENIZER_PRESETS.minimal);
  assert.deepEqual(min("The Cars and Trucks"), ["the", "cars", "and", "trucks"]);
});

test("resolveTokenizer handles preset names, options, and functions", () => {
  assert.deepEqual(resolveTokenizer("minimal")("cars"), ["cars"]); // no stemming
  assert.deepEqual(resolveTokenizer()("cars"), ["car"]); // default English stems
  const custom = resolveTokenizer({ stopwords: ["foo"], stem: (t) => t.toUpperCase() });
  assert.deepEqual(custom("foo bar"), ["BAR"]);
});

test("buildKeywordIndex honors a custom tokenizer (minimal = no plural stemming)", () => {
  const items = [item("1", "Cars")];
  const min = makeTokenizer(TOKENIZER_PRESETS.minimal);
  assert.equal(buildKeywordIndex(items, undefined, min).search("car", 5, false).length, 0); // "car" != "cars"
  assert.equal(buildKeywordIndex(items).search("car", 5, false)[0]?.id, "1"); // English stems cars→car
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

test("searchVectors clamps invalid k and sorts malformed vectors last (no NaN scramble)", () => {
  const index: PragmaIndex = {
    meta: { version: 1, model: "m", dtype: "q8", dim: 2, pooling: "mean", normalize: true, count: 3, builtAt: "" },
    items: [
      { id: "a", vector: [1, 0], payload: { id: "a", title: "A" } },
      { id: "b", vector: [0, 1], payload: { id: "b", title: "B" } },
      { id: "bad", vector: [1], payload: { id: "bad", title: "corrupt" } }, // wrong length
    ],
  };
  // negative/NaN k → clamped, not a slice-from-end / silent truncation
  assert.equal(searchVectors(index, [1, 0], -1).length, 0);
  assert.equal(searchVectors(index, [1, 0], NaN).length, 3); // NaN → default 10, capped at 3 items
  // the malformed vector scores -Infinity and sorts last; no NaN in the ranking
  const r = searchVectors(index, [1, 0], 3);
  assert.equal(r[0].id, "a");
  assert.equal(r[2].id, "bad");
  assert.ok(r.every((h) => !Number.isNaN(h.score)));
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

test("compact index: int8+gzip round-trips within quantization error and is much smaller", async () => {
  const { readFile: rf, stat } = await import("node:fs/promises");
  const dim = 384;
  // a normalized-ish vector
  const raw = Array.from({ length: dim }, (_, i) => Math.sin(i) / Math.sqrt(dim / 2));
  const idx: PragmaIndex = {
    meta: { version: 1, model: "m", dtype: "q8", dim, pooling: "mean", normalize: true, count: 1, builtAt: "" },
    items: Array.from({ length: 50 }, (_, n) => ({ id: `id${n}`, vector: raw, payload: { id: `id${n}`, title: `T${n}` } })),
  };
  const plain = join(tmpdir(), `ps-plain-${process.pid}.json`);
  const compact = join(tmpdir(), `ps-compact-${process.pid}.json.gz`);
  await saveIndex(plain, idx);
  await saveIndex(compact, idx, { compact: true });

  const loaded = await loadIndex(compact);
  assert.equal(loaded.items.length, 50);
  assert.equal(loaded.meta.vectorEncoding, undefined); // marker stripped after dequantize
  // dequantized vectors are close to the originals (int8/127 error)
  const maxErr = Math.max(...loaded.items[0].vector.map((v, i) => Math.abs(v - raw[i])));
  assert.ok(maxErr < 0.01, `max quant error ${maxErr}`);
  // and the file is much smaller
  const [{ size: sPlain }, { size: sCompact }] = await Promise.all([stat(plain), stat(compact)]);
  assert.ok(sCompact < sPlain / 3, `compact ${sCompact} vs plain ${sPlain}`);
  void rf;
  await rm(plain, { force: true });
  await rm(compact, { force: true });
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

test("matchesFilter: numeric-field refinements match their stringified facet values", () => {
  // computeFacets stringifies values, so a facet click on a numeric field sends "2020".
  const p: Product = { id: 1, title: "X", year: 2020 } as Product;
  assert.ok(matchesFilter(p, { year: "2020" })); // scalar string vs number field
  assert.ok(matchesFilter(p, { year: ["2019", "2020"] })); // array string vs number field
  assert.ok(!matchesFilter(p, { year: "2019" }));
  // and it doesn't break genuine same-type matches
  assert.ok(matchesFilter(p, { year: 2020 } as unknown as Filter));
});

test("matchesFilter: numeric range on an array field matches if ANY value is in range", () => {
  const p: Product = { id: 1, title: "X", sizes: [36, 42] } as Product;
  assert.ok(matchesFilter(p, { sizes: { gte: 40 } })); // 42 satisfies it
  assert.ok(matchesFilter(p, { sizes: { lte: 38 } })); // 36 satisfies it
  assert.ok(!matchesFilter(p, { sizes: { gte: 50 } }));
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

test("patchPayload ignores an `id` in the patch (can't desync payload.id from the item id)", () => {
  const idx = mkIndex([{ id: 1, vector: [0.5], payload: { id: 1, title: "A", price: 100 } }]);
  const n = patchPayload(idx, [{ id: 1, fields: { id: 999, price: 80 } as Partial<Product> }]);
  assert.equal(n, 1);
  assert.equal(idx.items[0].payload.id, 1); // id untouched
  assert.equal(idx.items[0].payload.price, 80); // other fields still applied
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

// ---------- signed search tokens ----------
test("signSearchToken/verifySearchToken round-trips and rejects tampering", () => {
  const secret = "s3cret";
  const token = signSearchToken({ filter: { tenant: "acme" } }, secret);
  assert.deepEqual(verifySearchToken(token, secret).filter, { tenant: "acme" });

  // wrong secret → rejected
  assert.throws(() => verifySearchToken(token, "nope"), /signature/);
  // tampered payload (swap the body) → rejected
  const forged = signSearchToken({ filter: { tenant: "evil" } }, "other");
  const spliced = forged.split(".")[0] + "." + token.split(".")[1];
  assert.throws(() => verifySearchToken(spliced, secret), /signature/);
});

test("verifySearchToken enforces expiry", () => {
  const secret = "s3cret";
  const token = signSearchToken({ filter: { tenant: "acme" }, exp: 1000 }, secret);
  assert.deepEqual(verifySearchToken(token, secret, 999).filter, { tenant: "acme" }); // not yet expired
  assert.throws(() => verifySearchToken(token, secret, 1001), /expired/);
});

test("mergeForcedFilter: forced fields win; client may only add narrowing fields", () => {
  // client can't widen the forced scope
  assert.deepEqual(
    mergeForcedFilter({ tenant: "evil", price: { lte: 100 } }, { tenant: "acme" }),
    { tenant: "acme", price: { lte: 100 } },
  );
  assert.deepEqual(mergeForcedFilter(undefined, { tenant: "acme" }), { tenant: "acme" });
  assert.deepEqual(mergeForcedFilter({ price: { lte: 50 } }, undefined), { price: { lte: 50 } });
});

// ---------- highlighting ----------
test("highlightField wraps stem-matching words and escapes HTML", () => {
  const out = highlightField("Wireless Headphones <b>", new Set(["wireless", "headphone"]));
  assert.match(out, /<mark>Wireless<\/mark>/);
  assert.match(out, /<mark>Headphones<\/mark>/); // plural matches "headphone"
  assert.match(out, /&lt;b&gt;/); // raw HTML in the source is escaped
  assert.ok(!out.includes("<b>"));
});

test("snippetField windows around the first match with ellipsis; short text stays full", () => {
  const long = "word ".repeat(40) + "the mechanical keyboard is great " + "word ".repeat(40);
  const snip = snippetField(long.trim(), new Set(["keyboard"]), 10);
  assert.match(snip, /^… /); // leading ellipsis (match isn't at the start)
  assert.match(snip, / …$/); // trailing ellipsis
  assert.match(snip, /<mark>keyboard<\/mark>/);
  assert.ok(snip.split(/\s+/).length < 20); // windowed, not the whole 80+ word text

  // short text → full highlight, no ellipsis
  const full = snippetField("Mechanical Keyboard", new Set(["keyboard"]), 10);
  assert.equal(full, "Mechanical <mark>Keyboard</mark>");
});

test("highlightProduct snippet option returns windowed excerpts", () => {
  const p: Product = { id: 1, title: "X", description: "alpha ".repeat(30) + "target here " + "beta ".repeat(30) };
  const h = highlightProduct(p, "target", { fields: ["description"], snippet: 8 });
  assert.match(h.description, /<mark>target<\/mark>/);
  assert.match(h.description, /…/);
  assert.ok(h.description.length < (p.description as string).length); // shorter than the full field
});

test("highlightProduct highlights requested fields; empty query → none", () => {
  const p: Product = { id: 1, title: "RTX 5090 Graphics Card", description: "for gaming" };
  const h = highlightProduct(p, "rtx graphics");
  assert.match(h.title, /<mark>RTX<\/mark>/);
  assert.match(h.title, /<mark>Graphics<\/mark>/);
  assert.deepEqual(highlightProduct(p, ""), {});
});

// ---------- F4: searchable attributes + field weights ----------
test("resolveSearchable normalizes strings, ^weights, objects; empty → default", () => {
  assert.deepEqual(resolveSearchable(["title^3", "brand", { field: "sku", weight: 2 }]), [
    { field: "title", weight: 3 },
    { field: "brand", weight: 1 },
    { field: "sku", weight: 2 },
  ]);
  // empty / degenerate configs fall back to the historical default
  assert.deepEqual(resolveSearchable([]), DEFAULT_SEARCHABLE);
  assert.deepEqual(resolveSearchable(undefined), DEFAULT_SEARCHABLE);
  assert.deepEqual(resolveSearchable([{ field: "", weight: 0 }]), DEFAULT_SEARCHABLE);
});

test("fieldText extracts strings, arrays, numbers; ignores objects/missing", () => {
  const p: Product = { id: 1, title: "T", tags: ["a", "b"], price: 9 };
  assert.equal(fieldText(p, "title"), "T");
  assert.equal(fieldText(p, "tags"), "a b"); // arrays space-joined
  assert.equal(fieldText(p, "price"), "9"); // numbers stringified
  assert.equal(fieldText(p, "missing"), "");
});

test("productText embeds selected fields in declared order, skipping empties", () => {
  const p: Product = { id: 1, title: "Mouse", brand: "Acme", description: "" };
  const attrs = resolveSearchable(["brand^2", "title", "description"]);
  assert.equal(productText(p, attrs), "Acme. Mouse");
});

test("buildKeywordIndex honors field weights and makes new fields searchable", () => {
  const items: IndexItem[] = [
    { id: "1", vector: [], payload: { id: "1", title: "Widget", brand: "Gaming" } },
    { id: "2", vector: [], payload: { id: "2", title: "Gaming", brand: "Acme" } },
  ];
  const weighted = buildKeywordIndex(
    items,
    resolveSearchable([{ field: "title", weight: 1 }, { field: "brand", weight: 5 }]),
  );
  // "gaming" sits in #1's weight-5 brand field → outranks #2 (weight-1 title)
  assert.equal(weighted.search("gaming", 5)[0].id, "1");
  // ...and brand is searchable now
  assert.equal(weighted.search("acme", 5)[0].id, "2");
  // the default config does NOT search brand → "acme" finds nothing
  assert.equal(buildKeywordIndex(items).search("acme", 5).length, 0);
});

test("exactTitleMatches can target a non-title field", () => {
  const items: IndexItem[] = [
    { id: "1", vector: [], payload: { id: "1", title: "X", brand: "Acme Corp" } },
    { id: "2", vector: [], payload: { id: "2", title: "Acme Corp", brand: "Other" } },
  ];
  const hits = exactTitleMatches("acme corp", items, "brand");
  assert.ok(hits.has("1"));
  assert.ok(!hits.has("2"));
});

// ---------- S1: synonyms ----------
test("buildSynonyms expands multi-way groups; undefined when empty", () => {
  assert.equal(buildSynonyms(undefined), undefined);
  assert.equal(buildSynonyms({ groups: [], oneWay: [] }), undefined);

  const expand = buildSynonyms({ groups: [["laptop", "notebook"]], weight: 0.5 })!;
  const out = new Map(expand(tokenize("cheap laptop")));
  assert.equal(out.get("laptop"), 1); // base query term stays weight 1
  assert.equal(out.get("notebook"), 0.5); // synonym at the reduced weight
  assert.equal(out.get("cheap"), 1);
});

test("synonyms let the keyword layer match equivalent terms", () => {
  const kw = buildKeywordIndex([
    item("1", "Ultrabook Notebook 14-inch"),
    item("2", "Wireless Mouse"),
  ]);
  const syn = buildSynonyms({ groups: [["laptop", "notebook"]] });
  assert.equal(kw.search("laptop", 5, false).length, 0); // no synonyms → "laptop" matches nothing
  assert.equal(kw.search("laptop", 5, false, syn)[0].id, "1"); // expands to "notebook" → #1
});

test("one-way synonyms are directional", () => {
  const kw = buildKeywordIndex([item("1", "Sneakers Pro")]);
  const syn = buildSynonyms({ oneWay: [{ from: "sneakers", to: ["trainers"] }] })!;
  // querying the TARGET term does not pull in the source doc
  assert.equal(kw.search("trainers", 5, false, syn).length, 0);
  // querying the SOURCE term still finds its literal doc
  assert.equal(kw.search("sneakers", 5, false, syn)[0].id, "1");
});

// ---------- S2: ranking rules (boost / bury / pin) ----------
const ranked = (rows: [string, number][]) =>
  rows.map(([id, score]) => ({ id, score, signals: [] as SearchSignal[] }));

test("applyRankingRules: pin forces ids to the top, in order, tagged 'pinned'", () => {
  const out = applyRankingRules(
    ranked([["a", 0.9], ["b", 0.5], ["c", 0.1]]),
    { pin: ["c", "b"] },
    () => undefined,
  );
  assert.deepEqual(out.map((r) => r.id), ["c", "b", "a"]);
  assert.ok(out[0].signals.includes("pinned"));
  assert.ok(!out[2].signals.includes("pinned")); // unpinned untouched
});

test("applyRankingRules: boost by filter lifts matching items; bury by id sinks them", () => {
  const payloads: Record<string, Product> = {
    a: { id: "a", title: "A", brand: "Acme" },
    b: { id: "b", title: "B", brand: "Other" },
    c: { id: "c", title: "C", brand: "Acme" },
  };
  const get = (id: string) => payloads[id];
  // top score = 1.0 → boost `by: 1` adds ~1.0; Acme items (a, c) jump above b
  const boosted = applyRankingRules(
    ranked([["b", 1.0], ["a", 0.6], ["c", 0.2]]),
    { boost: [{ filter: { brand: "Acme" }, by: 1 }] },
    get,
  );
  assert.deepEqual(boosted.map((r) => r.id), ["a", "c", "b"]);

  const buried = applyRankingRules(ranked([["b", 1.0], ["a", 0.6]]), { bury: [{ ids: ["b"], by: 1 }] }, get);
  assert.deepEqual(buried.map((r) => r.id), ["a", "b"]);
});

test("applyRankingRules: undefined rules is a no-op", () => {
  const rows = ranked([["a", 1]]);
  assert.equal(applyRankingRules(rows, undefined, () => undefined), rows);
});

test("applyRankingRules: customRanking tie-breaks within a relevance tier by business fields", () => {
  const p: Record<string, Product> = {
    a: { id: "a", title: "A", sales: 10, rating: 4 },
    b: { id: "b", title: "B", sales: 50, rating: 3 },
    c: { id: "c", title: "C", sales: 50, rating: 5 },
  };
  const get = (id: string) => p[id];
  // near-equal relevance scores (within the default 5% epsilon) → order by sales desc, then rating desc
  const out = applyRankingRules(
    ranked([["a", 1.0], ["b", 0.99], ["c", 0.98]]),
    { customRanking: ["desc(sales)", "desc(rating)"] },
    get,
  );
  assert.deepEqual(out.map((r) => r.id), ["c", "b", "a"]); // b & c (sales 50) above a; c's rating 5 > b's 3

  // when relevance differs beyond epsilon, relevance still dominates
  const out2 = applyRankingRules(
    ranked([["a", 1.0], ["b", 0.2]]),
    { customRanking: ["desc(sales)"] },
    get,
  );
  assert.deepEqual(out2.map((r) => r.id), ["a", "b"]); // a wins on relevance despite lower sales
});

test("parseCriterion shorthands: bare field = desc, asc()/desc(), missing sorts last", () => {
  const p: Record<string, Product> = {
    a: { id: "a", title: "A", price: 100 },
    b: { id: "b", title: "B", price: 20 },
    c: { id: "c", title: "C" }, // no price → last
  };
  const get = (id: string) => p[id];
  const out = applyRankingRules(ranked([["a", 1], ["b", 1], ["c", 1]]), { customRanking: ["asc(price)"] }, get);
  assert.deepEqual(out.map((r) => r.id), ["b", "a", "c"]); // 20, 100, then missing
});

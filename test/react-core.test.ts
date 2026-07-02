/**
 * Unit tests for the React adapter's framework-free core (no DOM/React needed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildSearchParams,
  searchUrl,
  buildFilter,
  toggleRefinement,
  fetchSearch,
} from "../src/react-core.js";

test("buildSearchParams omits defaults, encodes the rest", () => {
  assert.equal(buildSearchParams({ query: "hi" }), "q=hi"); // hybrid + typo:true are defaults → omitted
  const p = new URLSearchParams(
    buildSearchParams({
      query: "gaming",
      hitsPerPage: 12,
      offset: 24,
      mode: "keyword",
      typo: false,
      facets: ["category", "brand"],
      filter: { category: "Laptops" },
      highlight: true,
    }),
  );
  assert.equal(p.get("q"), "gaming");
  assert.equal(p.get("k"), "12");
  assert.equal(p.get("offset"), "24");
  assert.equal(p.get("mode"), "keyword");
  assert.equal(p.get("typo"), "off");
  assert.equal(p.get("facets"), "category,brand");
  assert.deepEqual(JSON.parse(p.get("filter")!), { category: "Laptops" });
  assert.equal(p.get("highlight"), "on");
});

test("searchUrl strips a trailing slash and supports same-origin", () => {
  assert.equal(searchUrl("https://x.com/", { query: "a" }), "https://x.com/api/search?q=a");
  assert.equal(searchUrl("", { query: "a" }), "/api/search?q=a");
});

test("buildFilter collapses single values, keeps arrays, folds in ranges", () => {
  assert.deepEqual(buildFilter({ category: ["Laptops"], brand: ["Apple", "Dell"] }), {
    category: "Laptops",
    brand: ["Apple", "Dell"],
  });
  assert.deepEqual(buildFilter({ category: [] }), {}); // empty refinement dropped
  assert.deepEqual(buildFilter({}, { price: { lte: 1000 } }), { price: { lte: 1000 } });
});

test("toggleRefinement adds, appends, and removes (deleting empty fields)", () => {
  const a = toggleRefinement({}, "category", "Laptops");
  assert.deepEqual(a, { category: ["Laptops"] });
  const b = toggleRefinement(a, "category", "Phones");
  assert.deepEqual(b, { category: ["Laptops", "Phones"] });
  const c = toggleRefinement(b, "category", "Laptops");
  assert.deepEqual(c, { category: ["Phones"] });
  const d = toggleRefinement(c, "category", "Phones");
  assert.deepEqual(d, {}); // last value removed → field deleted
});

test("fetchSearch hits /api/search with the built query and parses; throws on non-2xx", async () => {
  const orig = globalThis.fetch;
  try {
    let seen = "";
    globalThis.fetch = (async (url: string | URL) => {
      seen = String(url);
      return {
        ok: true,
        json: async () => ({
          query: "q", mode: "hybrid", ms: 1, count: 1, total: 1, offset: 0,
          results: [{ id: "1", score: 1, product: { id: "1", title: "X" } }],
        }),
      } as Response;
    }) as typeof fetch;
    const r = await fetchSearch("http://h", { query: "q", hitsPerPage: 5 });
    assert.match(seen, /^http:\/\/h\/api\/search\?q=q&k=5$/);
    assert.equal(r.results[0].product.title, "X");

    globalThis.fetch = (async () => ({ ok: false, status: 503 }) as Response) as typeof fetch;
    await assert.rejects(() => fetchSearch("http://h", { query: "q" }), /503/);
  } finally {
    globalThis.fetch = orig;
  }
});

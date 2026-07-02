/**
 * Unit tests for the search-analytics recorder (pure, deterministic via explicit ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createAnalytics, normalizeQuery } from "../src/analytics.js";

test("normalizeQuery trims, lowercases, collapses whitespace", () => {
  assert.equal(normalizeQuery("  RTX   4070 "), "rtx 4070");
  assert.equal(normalizeQuery(""), "");
});

test("record aggregates counts, zero-result rate, and empties (browse) separately", () => {
  const a = createAnalytics();
  a.record({ query: "laptop", results: 5, ts: 1 });
  a.record({ query: "Laptop", results: 5, ts: 2 }); // same normalized query
  a.record({ query: "unicorn saddle", results: 0, ts: 3 }); // zero-result
  a.record({ query: "", results: 0, ts: 4 }); // browse / empty — not a search

  const s = a.summary();
  assert.equal(s.totalSearches, 3);
  assert.equal(s.emptySearches, 1);
  assert.equal(s.zeroResultSearches, 1);
  assert.equal(s.zeroResultRate, 0.333);
  assert.equal(s.distinctQueries, 2);
});

test("zeroResultQueries lists only queries that returned nothing, most-frequent first", () => {
  const a = createAnalytics();
  a.record({ query: "vr headset", results: 0, ts: 1 });
  a.record({ query: "vr headset", results: 0, ts: 2 });
  a.record({ query: "drone", results: 0, ts: 3 });
  a.record({ query: "phone", results: 8, ts: 4 }); // has results → not in the list

  const s = a.summary();
  assert.deepEqual(
    s.zeroResultQueries.map((z) => [z.query, z.zero, z.searches]),
    [["vr headset", 2, 2], ["drone", 1, 1]],
  );
  assert.ok(!s.zeroResultQueries.some((z) => z.query === "phone"));
});

test("topQueries ranks by count with avgResults and zeroRate", () => {
  const a = createAnalytics();
  a.record({ query: "case", results: 10, ts: 1 });
  a.record({ query: "case", results: 0, ts: 2 }); // same query, sometimes empty
  a.record({ query: "cable", results: 4, ts: 3 });

  const [first] = a.summary().topQueries;
  assert.equal(first.query, "case");
  assert.equal(first.count, 2);
  assert.equal(first.avgResults, 5); // (10 + 0) / 2
  assert.equal(first.zeroRate, 0.5); // 1 of 2 empty
});

test("explicit zero flag overrides the results===0 heuristic (semantic 'no strong match')", () => {
  const a = createAnalytics();
  // vector/hybrid returns the full catalog, but the caller flags it as no strong match:
  a.record({ query: "flying carpet", results: 102, zero: true, ts: 1 });
  a.record({ query: "gaming", results: 102, zero: false, ts: 2 });
  const s = a.summary();
  assert.equal(s.zeroResultSearches, 1);
  assert.deepEqual(s.zeroResultQueries.map((z) => z.query), ["flying carpet"]);
});

test("latency percentiles over recorded ms", () => {
  const a = createAnalytics();
  for (let i = 1; i <= 100; i++) a.record({ query: `q${i}`, results: 1, ms: i, ts: i });
  const l = a.summary().latency;
  assert.equal(l.samples, 100);
  assert.equal(l.p50, 50);
  assert.equal(l.p95, 95);
  assert.equal(l.p99, 99);
  assert.equal(l.avg, 50.5);
});

test("distinct-query cap bounds memory but keeps aggregate totals correct", () => {
  const a = createAnalytics({ maxQueries: 2 });
  a.record({ query: "a", results: 1, ts: 1 });
  a.record({ query: "b", results: 0, ts: 2 });
  a.record({ query: "c", results: 0, ts: 3 }); // dropped from per-query breakdown
  const s = a.summary();
  assert.equal(s.distinctQueries, 2);
  assert.equal(s.capped, true);
  assert.equal(s.totalSearches, 3); // totals still counted
  assert.equal(s.zeroResultSearches, 2);
});

test("toJSON round-trips through createAnalytics", () => {
  const a = createAnalytics();
  a.record({ query: "gpu", results: 0, ts: 1 });
  a.record({ query: "gpu", results: 3, ts: 2 });
  const restored = createAnalytics({}, a.toJSON());
  assert.deepEqual(restored.summary(), a.summary());
  // continues accumulating on the restored instance
  restored.record({ query: "gpu", results: 0, ts: 3 });
  assert.equal(restored.summary().topQueries[0].count, 3);
});

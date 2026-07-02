/**
 * Integration tests for the hardened search server. Uses a stub searcher (no model
 * download) and a real HTTP listener on an ephemeral port.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import { createSearchServer } from "../src/server.js";
import { signSearchToken } from "../src/tokens.js";
import type { Searcher } from "../src/search.js";
import type { SearchOptions } from "../src/search.js";

interface Capture {
  lastQ?: string;
  lastOpts?: SearchOptions;
}

function stubSearcher(cap: Capture = {}): Searcher {
  return {
    index: {
      meta: { version: 1, model: "m", dtype: "q8", dim: 2, pooling: "mean", normalize: true, count: 3, builtAt: "" },
      items: [],
    },
    async search(q: string, k: number, opts: SearchOptions = {}) {
      cap.lastQ = q;
      cap.lastOpts = opts;
      return {
        hits: [{ id: "1", score: 1, product: { id: "1", title: "X" } }],
        total: 1,
        offset: opts.offset ?? 0,
        limit: k,
        maxScore: 0.9,
      };
    },
    patchPayload: (p) => p.length,
    async upsert(p) {
      return { added: p.length, updated: 0, reembedded: p.length };
    },
    remove: (ids) => ids.length,
    // fields the server never touches
  } as unknown as Searcher;
}

const listen = (server: import("node:http").Server): Promise<string> =>
  new Promise((resolve) => server.listen(0, () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));

test("createSearchServer: search, meta, token forcing, write auth, analytics gating", async () => {
  const cap: Capture = {};
  const { server } = createSearchServer(stubSearcher(cap), { adminToken: "adm", searchSecret: "sec" });
  const base = await listen(server);
  try {
    // meta
    assert.equal((await (await fetch(`${base}/api/meta`)).json()).meta.count, 3);

    // search
    const s = await (await fetch(`${base}/api/search?q=hi`)).json();
    assert.equal(s.total, 1);
    assert.equal(cap.lastQ, "hi");

    // signed token forces its filter into the query
    const tok = signSearchToken({ filter: { tenant: "acme" } }, "sec");
    await fetch(`${base}/api/search?q=hi&token=${encodeURIComponent(tok)}`);
    assert.deepEqual(cap.lastOpts?.filter, { tenant: "acme" });

    // bad token → 401
    assert.equal((await fetch(`${base}/api/search?q=hi&token=bad.sig`)).status, 401);

    // write without auth → 401; with auth → ok
    assert.equal((await fetch(`${base}/api/remove`, { method: "POST", body: "{}" })).status, 401);
    const rem = await (await fetch(`${base}/api/remove`, {
      method: "POST",
      headers: { authorization: "Bearer adm" },
      body: JSON.stringify({ ids: ["1", "2"] }),
    })).json();
    assert.equal(rem.removed, 2);

    // analytics not enabled on this server → 404
    assert.equal((await fetch(`${base}/api/analytics`, { headers: { authorization: "Bearer adm" } })).status, 404);
  } finally {
    server.close();
  }
});

test("createSearchServer: per-IP rate limiting on /api/search", async () => {
  const { server } = createSearchServer(stubSearcher(), { rateLimit: 2 });
  const base = await listen(server);
  try {
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await fetch(`${base}/api/search?q=hi`)).status);
    assert.deepEqual(codes, [200, 200, 429]);
  } finally {
    server.close();
  }
});

test("createSearchServer: spoofed X-Forwarded-For does NOT bypass the limit (trustProxy off by default)", async () => {
  const { server } = createSearchServer(stubSearcher(), { rateLimit: 2 });
  const base = await listen(server);
  try {
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) {
      codes.push((await fetch(`${base}/api/search?q=hi`, { headers: { "x-forwarded-for": `1.2.3.${i}` } })).status);
    }
    // all requests key on the real socket, so a spoofed header can't mint fresh buckets
    assert.deepEqual(codes, [200, 200, 429]);
  } finally {
    server.close();
  }
});

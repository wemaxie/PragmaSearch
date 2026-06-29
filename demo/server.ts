/**
 * Local demo server for PragmaSearch.
 *
 * Serves a tiny search UI and a /api/search endpoint. Reuses the exact same
 * engine the CLI uses — on each request it embeds the query in Node and runs
 * the brute-force cosine search over the loaded index. No new dependencies.
 *
 * Run:  npx tsx demo/server.ts        (or: npm run demo)
 * Then open http://localhost:5173
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { buildIndex } from "../src/index-builder.js";
import { createSearcher, type Searcher } from "../src/search.js";
import { readProducts, saveIndex, loadIndex } from "../src/storage.js";
import type { PragmaIndex, SearchMode } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

/** Resolve a path from an env var (relative to the project root) or fall back. */
const fromEnv = (v: string | undefined, fallback: string): string =>
  v ? (isAbsolute(v) ? v : join(ROOT, v)) : fallback;

// Index file precedence: CLI arg (`tsx demo/server.ts <file>`) > PRAGMA_INDEX env > default.
const INDEX_FILE = fromEnv(
  process.argv[2] ?? process.env.PRAGMA_INDEX,
  join(ROOT, "pragmasearch-index.json"),
);
const PRODUCTS_FILE = fromEnv(process.env.PRAGMA_PRODUCTS, join(ROOT, "data", "products.json"));
const HTML_FILE = join(__dirname, "index.html");
const PORT = Number(process.env.PORT ?? 5173);

const DEFAULT_CHIPS = [
  "something for gaming",
  "make fresh coffee at home",
  "comfortable seat for long workdays",
  "listen to music on the go",
  "work from home setup",
];
const CHIPS = process.env.PRAGMA_CHIPS
  ? process.env.PRAGMA_CHIPS.split("|").map((s) => s.trim()).filter(Boolean)
  : DEFAULT_CHIPS;

/** Load the index, building it from the demo products if it doesn't exist yet. */
async function getIndex(): Promise<PragmaIndex> {
  if (existsSync(INDEX_FILE)) {
    return loadIndex(INDEX_FILE);
  }
  console.log("No index found — building one from data/products.json ...");
  const products = await readProducts(PRODUCTS_FILE);
  const index = await buildIndex(products, {
    onBatch: (d, t) => process.stdout.write(`\r  embedded ${d}/${t}   `),
  });
  await saveIndex(INDEX_FILE, index);
  console.log(`\n  built ${index.meta.count} items.`);
  return index;
}

function json(res: import("node:http").ServerResponse, code: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function main(): Promise<void> {
  console.log("Loading model + index ...");
  const index = await getIndex();
  const searcher: Searcher = await createSearcher(index);
  // Warm up the model so the first real query is fast.
  await searcher.search("warm up", 1);
  console.log(
    `Ready. ${index.meta.count} items · model ${index.meta.model} (${index.meta.dtype}).`,
  );

  const html = await readFile(HTML_FILE, "utf8");

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/meta") {
        json(res, 200, { meta: index.meta, chips: CHIPS });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/search") {
        const q = (url.searchParams.get("q") ?? "").trim();
        const k = Math.min(Number(url.searchParams.get("k") ?? 12) || 12, 50);
        const modeParam = url.searchParams.get("mode");
        const mode: SearchMode =
          modeParam === "vector" || modeParam === "keyword" ? modeParam : "hybrid";
        const typo = url.searchParams.get("typo") !== "off"; // default on
        if (!q) {
          json(res, 200, { query: "", mode, ms: 0, count: index.meta.count, results: [] });
          return;
        }
        const t0 = performance.now();
        const results = await searcher.search(q, k, { mode, typo });
        const ms = +(performance.now() - t0).toFixed(1);
        json(res, 200, { query: q, mode, ms, count: index.meta.count, results });
        return;
      }

      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
  });

  server.listen(PORT, () => {
    console.log(`\n  PragmaSearch demo → http://localhost:${PORT}\n`);
  });
}

main().catch((err) => {
  console.error(`demo server: ${err.message}`);
  process.exit(1);
});

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
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";

import { buildIndex } from "../src/index-builder.js";
import { createSearcher, type Searcher } from "../src/search.js";
import { readProducts, saveIndex, loadIndex } from "../src/storage.js";
import type { SynonymOptions } from "../src/synonyms.js";
import type { PragmaIndex, SearchMode, Product } from "../src/types.js";

// Write endpoints (live index updates) are enabled only when an admin token is set.
const ADMIN_TOKEN = process.env.PRAGMA_ADMIN_TOKEN;

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
const WIDGET_DIR = join(ROOT, "widget");
const PORT = Number(process.env.PORT ?? 5173);
// Allow the drop-in widget to call the read API cross-origin (it runs on the shop's own site).
const CORS_ORIGIN = process.env.PRAGMA_CORS_ORIGIN || "*";

// Input + abuse limits for the public-facing demo.
const MAX_QUERY_CHARS = 200; // queries longer than this are truncated (DoS guard)
const RATE_LIMIT = 30; // requests per window per client
const RATE_WINDOW_MS = 10_000;

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

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  // Allow the inline demo script/styles and product images over https; lock everything else down.
  "content-security-policy":
    "default-src 'self'; img-src 'self' https: data:; script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
};

/** Load a synonyms config from PRAGMA_SYNONYMS (a JSON file), if set. */
async function getSynonyms(): Promise<SynonymOptions | undefined> {
  const file = process.env.PRAGMA_SYNONYMS;
  if (!file) return undefined;
  try {
    return JSON.parse(await readFile(fromEnv(file, file), "utf8")) as SynonymOptions;
  } catch (e) {
    console.warn(`PRAGMA_SYNONYMS: ignoring ${file} (${(e as Error).message})`);
    return undefined;
  }
}

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

/** Send a body, gzipped when the client accepts it (cuts the ~1MB titles payload ~5x). */
function send(
  req: IncomingMessage,
  res: ServerResponse,
  code: number,
  contentType: string,
  body: string | Buffer,
  extra: Record<string, string> = {},
): void {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const headers: Record<string, string> = {
    "content-type": contentType,
    ...SECURITY_HEADERS,
    ...extra,
  };
  const acceptsGzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
  if (acceptsGzip && buf.length > 600) {
    res.writeHead(code, { ...headers, "content-encoding": "gzip", vary: "accept-encoding" });
    res.end(gzipSync(buf));
  } else {
    res.writeHead(code, headers);
    res.end(buf);
  }
}

function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  code: number,
  body: unknown,
  cacheControl = "no-store",
): void {
  send(req, res, code, "application/json; charset=utf-8", JSON.stringify(body), {
    "cache-control": cacheControl,
    "access-control-allow-origin": CORS_ORIGIN,
  });
}

/** Tiny in-memory token-bucket rate limiter keyed on client IP (behind a proxy on Railway/Render). */
const buckets = new Map<string, { tokens: number; reset: number }>();
function rateLimited(req: IncomingMessage): boolean {
  const ip =
    String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "unknown";
  const now = performance.now();
  const b = buckets.get(ip);
  if (!b || now > b.reset) {
    buckets.set(ip, { tokens: RATE_LIMIT - 1, reset: now + RATE_WINDOW_MS });
    if (buckets.size > 10_000) buckets.clear(); // crude memory bound
    return false;
  }
  if (b.tokens <= 0) return true;
  b.tokens--;
  return false;
}

/** Authorize a write request against PRAGMA_ADMIN_TOKEN. Writes are off unless the token is set. */
function authedWrite(req: IncomingMessage): boolean {
  if (!ADMIN_TOKEN) return false;
  return String(req.headers["authorization"] ?? "") === `Bearer ${ADMIN_TOKEN}`;
}

/** Read and JSON-parse a request body, bounded in size. */
function readJsonBody(req: IncomingMessage, maxBytes = 8_000_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function main(): Promise<void> {
  console.log("Loading model + index ...");
  const index = await getIndex();
  const synonyms = await getSynonyms();
  if (synonyms) console.log("  synonyms enabled (PRAGMA_SYNONYMS).");
  const searcher: Searcher = await createSearcher(index, { synonyms });

  // Lightweight title list for instant client-side autocomplete (no model call).
  // Rebuilt after live index updates.
  const buildTitlesBody = (): string =>
    JSON.stringify({
      items: index.items.map((it) => {
        const p = it.payload;
        return { id: p.id, title: p.title, category: p.category, price: p.price, currency: p.currency, image: p.image };
      }),
    });
  let titlesBody = buildTitlesBody();

  // Persist the in-memory index to disk after a write, and refresh the autocomplete list.
  async function persist(): Promise<void> {
    titlesBody = buildTitlesBody();
    await saveIndex(INDEX_FILE, index);
  }

  // Warm up the model so the first real query is fast.
  await searcher.search("warm up", 1);
  console.log(`Ready. ${index.meta.count} items · model ${index.meta.model} (${index.meta.dtype}).`);

  const html = await readFile(HTML_FILE, "utf8");

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

      if (req.method === "GET" && url.pathname === "/") {
        send(req, res, 200, "text/html; charset=utf-8", html);
        return;
      }

      // Serve the drop-in widget (JS/CSS at their real filenames) + an example page at /widget.
      {
        const widgetFiles: Record<string, [string, string]> = {
          "/pragmasearch-widget.js": ["pragmasearch-widget.js", "application/javascript; charset=utf-8"],
          "/pragmasearch-widget.css": ["pragmasearch-widget.css", "text/css; charset=utf-8"],
          "/widget": ["demo.html", "text/html; charset=utf-8"],
        };
        const entry = widgetFiles[url.pathname];
        if (req.method === "GET" && entry) {
          try {
            const body = await readFile(join(WIDGET_DIR, entry[0]), "utf8");
            send(req, res, 200, entry[1], body, { "access-control-allow-origin": CORS_ORIGIN });
          } catch {
            send(req, res, 404, "text/plain; charset=utf-8", "not found");
          }
          return;
        }
      }

      if (req.method === "GET" && url.pathname === "/api/meta") {
        sendJson(req, res, 200, { meta: index.meta, chips: CHIPS });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/titles") {
        send(req, res, 200, "application/json; charset=utf-8", titlesBody, {
          "cache-control": "public, max-age=3600",
          "access-control-allow-origin": CORS_ORIGIN,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/search") {
        if (rateLimited(req)) {
          sendJson(req, res, 429, { error: "rate limit exceeded, slow down" });
          return;
        }
        // Truncate over-long queries before they hit the (CPU-heavy) typo/embedding path.
        const q = (url.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_CHARS);
        const k = Math.min(Math.max(Number(url.searchParams.get("k") ?? 12) || 12, 1), 50);
        const modeParam = url.searchParams.get("mode");
        const mode: SearchMode =
          modeParam === "vector" || modeParam === "keyword" ? modeParam : "hybrid";
        const typo = url.searchParams.get("typo") !== "off"; // default on
        const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
        const facetsParam = url.searchParams.get("facets");
        const facets = facetsParam
          ? facetsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10)
          : undefined;
        let filter: Record<string, unknown> | undefined;
        try {
          const fp = url.searchParams.get("filter");
          if (fp) filter = JSON.parse(fp);
        } catch {
          filter = undefined; // ignore malformed filters
        }
        if (!q && !filter) {
          sendJson(req, res, 200, { query: "", mode, ms: 0, count: index.meta.count, total: 0, results: [] });
          return;
        }
        const highlight = url.searchParams.get("highlight") === "on";
        const t0 = performance.now();
        const resp = await searcher.search(q, k, { mode, typo, offset, facets, filter, highlight });
        const ms = +(performance.now() - t0).toFixed(1);
        sendJson(req, res, 200, {
          query: q,
          mode,
          ms,
          count: index.meta.count,
          total: resp.total,
          offset: resp.offset,
          results: resp.hits,
          facets: resp.facets,
        });
        return;
      }

      // ---- live index updates (require PRAGMA_ADMIN_TOKEN) ----
      if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        const write = ["/api/patch", "/api/upsert", "/api/remove"].includes(url.pathname);
        if (write) {
          if (!authedWrite(req)) {
            sendJson(req, res, ADMIN_TOKEN ? 401 : 403, {
              error: ADMIN_TOKEN ? "unauthorized" : "write endpoints disabled (set PRAGMA_ADMIN_TOKEN)",
            });
            return;
          }
          const body = (await readJsonBody(req)) as Record<string, unknown>;

          if (url.pathname === "/api/patch") {
            // { patches: [{ id, fields }] } — payload-only (price/stock), no re-embed.
            const patches = Array.isArray(body.patches) ? (body.patches as { id: string | number; fields: Partial<Product> }[]) : [];
            const patched = searcher.patchPayload(patches);
            await persist();
            sendJson(req, res, 200, { patched, count: index.meta.count });
            return;
          }
          if (url.pathname === "/api/upsert") {
            // { products: [...] } — embeds only new/text-changed; reuses vectors otherwise.
            const products = Array.isArray(body.products) ? (body.products as Product[]) : [];
            const result = await searcher.upsert(products);
            await persist();
            sendJson(req, res, 200, { ...result, count: index.meta.count });
            return;
          }
          if (url.pathname === "/api/remove") {
            // { ids: [...] }
            const ids = Array.isArray(body.ids) ? (body.ids as (string | number)[]) : [];
            const removed = searcher.remove(ids);
            await persist();
            sendJson(req, res, 200, { removed, count: index.meta.count });
            return;
          }
        }
      }

      send(req, res, 404, "text/plain; charset=utf-8", "not found");
    } catch (err) {
      // Log details server-side; never leak internals (paths, model errors) to the client.
      console.error("request error:", err);
      sendJson(req, res, 500, { error: "internal error" });
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

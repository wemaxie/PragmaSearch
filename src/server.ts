import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Searcher } from "./search.js";
import { verifySearchToken, mergeForcedFilter } from "./tokens.js";
import type { Analytics } from "./analytics.js";
import type { Filter, Product, SearchMode } from "./types.js";

/**
 * A hardened, dependency-free HTTP search server you can ship to production —
 * the same security posture as the demo (input clamp, per-IP rate limiting,
 * restrictive headers, gzip, no internal-error leakage), factored into a reusable
 * export. It serves the JSON API only; put a UI in front of it with the drop-in
 * widget or the React/Vue adapters (they call `/api/search`).
 *
 * Endpoints: `GET /api/search`, `GET /api/meta`, token-gated
 * `POST /api/patch|upsert|remove`, and (when an analytics recorder is passed)
 * token-gated `GET /api/analytics` + `POST /api/analytics/reset`.
 */
export interface SearchServerOptions {
  /** `Access-Control-Allow-Origin` for reads. Default `"*"`. */
  corsOrigin?: string;
  /** Truncate queries longer than this (DoS guard). Default 200. */
  maxQueryChars?: number;
  /** Max results per page a client may request. Default 50. */
  maxHitsPerPage?: number;
  /** Requests per window per IP on `/api/search`. Default 60; 0 disables. */
  rateLimit?: number;
  /** Rate-limit window. Default 10000 ms. */
  rateWindowMs?: number;
  /** Bearer token that enables the write + analytics endpoints. Unset = those are disabled. */
  adminToken?: string;
  /** Secret for signed search tokens (`&token=` forced filters). Unset = tokens rejected. */
  searchSecret?: string;
  /** Optional analytics recorder — records every search and enables `/api/analytics`. */
  analytics?: Analytics;
  /** Top-similarity below which a vector/hybrid query counts as zero-result. Default 0.35. */
  zeroFloor?: number;
  /**
   * Trust the client `X-Forwarded-For` header for rate-limit keying. Enable ONLY
   * behind a proxy that overwrites it (Railway/Render/nginx); otherwise it's
   * attacker-controlled and defeats the limit. Default `false` (key on the socket).
   */
  trustProxy?: boolean;
  /** Called after a successful write (e.g. to persist the index / analytics). */
  onWrite?: () => void | Promise<void>;
}

export interface SearchServer {
  /** The raw `(req, res)` handler — mount it in your own server if you prefer. */
  handler: (req: IncomingMessage, res: ServerResponse) => void;
  /** A ready `http.Server` wrapping the handler. */
  server: Server;
  /** Convenience: start listening. */
  listen: (port: number, cb?: () => void) => Server;
}

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
};

/** Constant-time string compare for secrets (the admin bearer token), like tokens.ts does for HMACs. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Build a hardened search server around a {@link Searcher}. Does not start listening unless you call `listen`. */
export function createSearchServer(searcher: Searcher, opts: SearchServerOptions = {}): SearchServer {
  const CORS = opts.corsOrigin ?? "*";
  const MAX_Q = opts.maxQueryChars ?? 200;
  const MAX_K = opts.maxHitsPerPage ?? 50;
  const RATE = opts.rateLimit ?? 60;
  const WINDOW = opts.rateWindowMs ?? 10_000;
  const ADMIN = opts.adminToken;
  const SECRET = opts.searchSecret;
  const analytics = opts.analytics;
  const ZERO_FLOOR = opts.zeroFloor ?? 0.35;
  const TRUST_PROXY = opts.trustProxy ?? false;

  function send(req: IncomingMessage, res: ServerResponse, code: number, type: string, body: string | Buffer, extra: Record<string, string> = {}): void {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const headers: Record<string, string> = { "content-type": type, ...SECURITY_HEADERS, ...extra };
    if (/\bgzip\b/.test(String(req.headers["accept-encoding"] ?? "")) && buf.length > 600) {
      res.writeHead(code, { ...headers, "content-encoding": "gzip", vary: "accept-encoding" });
      res.end(gzipSync(buf));
    } else {
      res.writeHead(code, headers);
      res.end(buf);
    }
  }
  const sendJson = (req: IncomingMessage, res: ServerResponse, code: number, body: unknown): void =>
    send(req, res, code, "application/json; charset=utf-8", JSON.stringify(body), {
      "cache-control": "no-store",
      "access-control-allow-origin": CORS,
    });

  const buckets = new Map<string, { tokens: number; reset: number }>();
  function rateLimited(req: IncomingMessage): boolean {
    if (RATE <= 0) return false;
    // Only trust X-Forwarded-For behind a proxy that overwrites it; otherwise it's
    // client-controlled and every spoofed value would get a fresh bucket.
    const xff = TRUST_PROXY ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
    const ip = xff || req.socket.remoteAddress || "unknown";
    const now = performance.now();
    const b = buckets.get(ip);
    if (!b || now > b.reset) {
      buckets.set(ip, { tokens: RATE - 1, reset: now + WINDOW });
      // Bound memory by pruning only EXPIRED buckets (never a global clear, which
      // would reset every client's counter and let a burst past the cap).
      if (buckets.size > 10_000) {
        for (const [key, v] of buckets) if (v.reset <= now) buckets.delete(key);
      }
      return false;
    }
    if (b.tokens <= 0) return true;
    b.tokens--;
    return false;
  }

  const authed = (req: IncomingMessage): boolean =>
    !!ADMIN && safeEqual(String(req.headers["authorization"] ?? ""), `Bearer ${ADMIN}`);
  const denyAuth = (req: IncomingMessage, res: ServerResponse): void =>
    sendJson(req, res, ADMIN ? 401 : 403, { error: ADMIN ? "unauthorized" : "endpoint disabled (no admin token configured)" });

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

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (req.method === "GET" && path === "/api/meta") {
      sendJson(req, res, 200, { meta: searcher.index.meta });
      return;
    }

    if (req.method === "GET" && path === "/api/search") {
      if (rateLimited(req)) {
        sendJson(req, res, 429, { error: "rate limit exceeded, slow down" });
        return;
      }
      const q = (url.searchParams.get("q") ?? "").trim().slice(0, MAX_Q);
      const k = Math.min(Math.max(Number(url.searchParams.get("k") ?? 12) || 12, 1), MAX_K);
      const modeParam = url.searchParams.get("mode");
      const mode: SearchMode = modeParam === "vector" || modeParam === "keyword" ? modeParam : "hybrid";
      const typo = url.searchParams.get("typo") !== "off";
      const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
      const facetsParam = url.searchParams.get("facets");
      const facets = facetsParam ? facetsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10) : undefined;
      let filter: Filter | undefined;
      try {
        const fp = url.searchParams.get("filter");
        if (fp) filter = JSON.parse(fp) as Filter;
      } catch {
        filter = undefined;
      }
      const tokenParam = url.searchParams.get("token");
      if (tokenParam) {
        if (!SECRET) {
          sendJson(req, res, 401, { error: "search tokens not enabled" });
          return;
        }
        try {
          filter = mergeForcedFilter(filter, verifySearchToken(tokenParam, SECRET).filter);
        } catch {
          sendJson(req, res, 401, { error: "invalid or expired search token" });
          return;
        }
      }
      if (!q && !filter) {
        sendJson(req, res, 200, { query: "", mode, ms: 0, count: searcher.index.meta.count, total: 0, results: [] });
        return;
      }
      const snippet = Math.max(0, Math.min(Number(url.searchParams.get("snippet") ?? 0) || 0, 60));
      const highlight = snippet ? { snippet } : url.searchParams.get("highlight") === "on";
      const t0 = performance.now();
      const resp = await searcher.search(q, k, { mode, typo, offset, facets, filter, highlight });
      const ms = +(performance.now() - t0).toFixed(1);
      if (analytics) {
        const weak = mode !== "keyword" && resp.maxScore != null && resp.maxScore < ZERO_FLOOR;
        analytics.record({ query: q, results: resp.total, zero: !!q && (resp.total === 0 || weak), ms, mode, filtered: !!filter });
      }
      sendJson(req, res, 200, {
        query: q, mode, ms, count: searcher.index.meta.count,
        total: resp.total, maxScore: resp.maxScore, offset: resp.offset, results: resp.hits, facets: resp.facets,
      });
      return;
    }

    if (req.method === "GET" && path === "/api/analytics") {
      if (!analytics) {
        sendJson(req, res, 404, { error: "analytics not enabled" });
        return;
      }
      if (!authed(req)) return denyAuth(req, res);
      const topN = Math.min(Math.max(Number(url.searchParams.get("topN") ?? 20) || 20, 1), 100);
      sendJson(req, res, 200, analytics.summary({ topN }));
      return;
    }

    if (req.method === "POST" && (path === "/api/patch" || path === "/api/upsert" || path === "/api/remove" || path === "/api/analytics/reset")) {
      if (!authed(req)) return denyAuth(req, res);
      let body: Record<string, unknown>;
      try {
        body = (await readJsonBody(req)) as Record<string, unknown>;
      } catch {
        sendJson(req, res, 400, { error: "invalid request body" });
        return;
      }
      if (path === "/api/patch") {
        const patches = Array.isArray(body.patches) ? (body.patches as { id: string | number; fields: Partial<Product> }[]) : [];
        const patched = searcher.patchPayload(patches);
        await opts.onWrite?.();
        sendJson(req, res, 200, { patched, count: searcher.index.meta.count });
      } else if (path === "/api/upsert") {
        const products = Array.isArray(body.products) ? (body.products as Product[]) : [];
        const result = await searcher.upsert(products);
        await opts.onWrite?.();
        sendJson(req, res, 200, { ...result, count: searcher.index.meta.count });
      } else if (path === "/api/remove") {
        const ids = Array.isArray(body.ids) ? (body.ids as (string | number)[]) : [];
        const removed = searcher.remove(ids);
        await opts.onWrite?.();
        sendJson(req, res, 200, { removed, count: searcher.index.meta.count });
      } else {
        analytics?.reset();
        await opts.onWrite?.();
        sendJson(req, res, 200, { ok: true });
      }
      return;
    }

    sendJson(req, res, 404, { error: "not found" });
  }

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    handle(req, res).catch((err) => {
      // Log server-side; never leak internals to the client.
      console.error("pragmasearch server error:", err);
      try {
        sendJson(req, res, 500, { error: "internal error" });
      } catch {
        /* response already sent */
      }
    });
  };

  const server = createServer(handler);
  return { handler, server, listen: (port, cb) => server.listen(port, cb) };
}

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Filter } from "./types.js";

/**
 * Signed search tokens — multi-tenant filter enforcement.
 *
 * A token embeds a **forced filter** (and optional expiry) and is HMAC-signed with
 * a server secret. You hand a tenant a token scoped to `{ tenantId: "acme" }`; the
 * browser sends it with every search, and the server AND-s the forced filter into
 * the query. Because the browser can't forge the signature, it can't widen or drop
 * the scope — it can only narrow within it. Zero dependencies (`node:crypto`).
 *
 * Format (JWT-like, compact): `base64url(JSON payload) + "." + base64url(HMAC-SHA256)`.
 * The payload is signed, not encrypted — don't put secrets in the filter.
 */

export interface SearchTokenPayload {
  /** Forced filter, always AND-ed into the query. The client can't remove or widen it. */
  filter?: Filter;
  /** Expiry as a Unix epoch in **seconds**. Omit for a non-expiring token. */
  exp?: number;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function hmac(data: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

/** Sign a search token with a server secret. */
export function signSearchToken(payload: SearchTokenPayload, secret: string): string {
  if (!secret) throw new Error("signSearchToken: a non-empty secret is required");
  const body = b64url(Buffer.from(JSON.stringify(payload ?? {}), "utf8"));
  return `${body}.${b64url(hmac(body, secret))}`;
}

/**
 * Verify a search token and return its payload. Throws on a bad/tampered signature
 * or an expired token. `nowSec` is injectable for testing.
 */
export function verifySearchToken(
  token: string,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): SearchTokenPayload {
  if (!secret) throw new Error("verifySearchToken: a non-empty secret is required");
  const dot = token.indexOf(".");
  if (dot < 0) throw new Error("malformed token");
  const body = token.slice(0, dot);
  const sig = b64urlDecode(token.slice(dot + 1));
  const expected = hmac(body, secret);
  // constant-time compare (guard length first — timingSafeEqual throws on mismatch)
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
    throw new Error("bad token signature");
  }
  let payload: SearchTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString("utf8")) as SearchTokenPayload;
  } catch {
    throw new Error("malformed token payload");
  }
  if (payload.exp != null && nowSec > payload.exp) throw new Error("token expired");
  return payload;
}

/**
 * AND a forced filter into a client filter. Forced fields win, so the client can
 * only add *narrowing* fields — it can't relax or remove the enforced scope.
 */
export function mergeForcedFilter(
  clientFilter: Filter | undefined,
  forced: Filter | undefined,
): Filter | undefined {
  if (!forced) return clientFilter;
  return { ...(clientFilter ?? {}), ...forced };
}

import { readFile, writeFile } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import type { PragmaIndex, Product, IndexItem } from "./types.js";

/** Read a products JSON file. Accepts either a bare array or `{ products: [...] }`. */
export async function readProducts(path: string): Promise<Product[]> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  const products = Array.isArray(parsed) ? parsed : parsed.products;
  if (!Array.isArray(products)) {
    throw new Error(
      `${path}: expected a JSON array of products or { "products": [...] }`,
    );
  }
  const seen = new Set<string>();
  for (const [i, p] of products.entries()) {
    if (p == null || typeof p !== "object" || p.id == null || p.title == null) {
      throw new Error(`${path}: product #${i} must have at least { id, title }`);
    }
    // ids are keyed as strings internally, so "123" and 123 would collide — reject duplicates.
    const key = String(p.id);
    if (seen.has(key)) {
      throw new Error(`${path}: duplicate product id ${JSON.stringify(p.id)} (ids must be unique)`);
    }
    seen.add(key);
  }
  return products as Product[];
}

/** Quantize a normalized float vector to int8, packed as base64 (1 byte/dim). */
export function quantizeVector(v: number[]): string {
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) {
    // clamp to [-127, 127] so the mapping is symmetric and reversible.
    q[i] = Math.max(-127, Math.min(127, Math.round(v[i] * 127)));
  }
  return Buffer.from(q.buffer, q.byteOffset, q.byteLength).toString("base64");
}

/** Inverse of {@link quantizeVector}: base64 int8 → float array (÷127). */
export function dequantizeVector(b64: string): number[] {
  const buf = Buffer.from(b64, "base64");
  const q = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Array<number>(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i] / 127;
  return out;
}

export interface SaveOptions {
  /**
   * Compact format: int8-quantized vectors (base64) + gzip. ~10× smaller on disk
   * with a tiny (~0.4%) quantization error. `loadIndex` reads it transparently.
   */
  compact?: boolean;
}

/** Write the index to disk — plain JSON by default, or compact (int8 + gzip) with `{ compact: true }`. */
export async function saveIndex(path: string, index: PragmaIndex, opts: SaveOptions = {}): Promise<void> {
  if (!opts.compact) {
    await writeFile(path, JSON.stringify(index), "utf8");
    return;
  }
  const compact = {
    ...index,
    meta: { ...index.meta, vectorEncoding: "int8" as const },
    items: index.items.map((it) => ({ id: it.id, vector: quantizeVector(it.vector), payload: it.payload })),
  };
  await writeFile(path, gzipSync(Buffer.from(JSON.stringify(compact), "utf8")));
}

/** Load an index from disk. Transparently gunzips and dequantizes compact (int8) artifacts. */
export async function loadIndex(path: string): Promise<PragmaIndex> {
  const bytes = await readFile(path);
  // gzip magic number 0x1f 0x8b → gunzip first.
  const text = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
    ? gunzipSync(bytes).toString("utf8")
    : bytes.toString("utf8");
  const parsed = JSON.parse(text) as PragmaIndex & { items: Array<Omit<IndexItem, "vector"> & { vector: number[] | string }> };

  if (parsed.meta?.vectorEncoding === "int8") {
    parsed.items = parsed.items.map((it) => ({
      ...it,
      vector: typeof it.vector === "string" ? dequantizeVector(it.vector) : it.vector,
    }));
    // In memory vectors are floats again; drop the on-disk marker so a re-save is consistent.
    delete parsed.meta.vectorEncoding;
  }
  return parsed as PragmaIndex;
}

import { readFile, writeFile } from "node:fs/promises";
import type { PragmaIndex, Product } from "./types.js";

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
  for (const [i, p] of products.entries()) {
    if (p == null || typeof p !== "object" || p.id == null || p.title == null) {
      throw new Error(`${path}: product #${i} must have at least { id, title }`);
    }
  }
  return products as Product[];
}

/** Write the index to disk as JSON. (Gzip shipping for the browser comes in a later phase.) */
export async function saveIndex(path: string, index: PragmaIndex): Promise<void> {
  await writeFile(path, JSON.stringify(index), "utf8");
}

/** Load an index from disk. */
export async function loadIndex(path: string): Promise<PragmaIndex> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as PragmaIndex;
}

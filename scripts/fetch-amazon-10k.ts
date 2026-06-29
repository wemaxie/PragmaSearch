/**
 * Fetch a real ~10k product catalog (Amazon products, public HF dataset
 * `bprateek/amazon_product_description`) via the HuggingFace datasets-server
 * REST API — no auth, no SDK — and normalize it into PragmaSearch's product
 * shape. Writes data/products-10k.json.
 *
 * Run: npx tsx scripts/fetch-amazon-10k.ts
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Product } from "../src/types.js";

const DATASET = "bprateek/amazon_product_description";
const PAGE = 100;
const TARGET = 10002;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "products-10k.json");

const BASE = "https://datasets-server.huggingface.co/rows";

interface Row {
  [k: string]: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(offset: number): Promise<Row[]> {
  const url = `${BASE}?dataset=${encodeURIComponent(DATASET)}&config=default&split=train&offset=${offset}&length=${PAGE}`;
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) throw new Error("429"); // rate limited — back off hard
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { rows?: { row: Row }[] };
      return (json.rows ?? []).map((r) => r.row);
    } catch (err) {
      if (attempt === 6) throw err;
      // exponential backoff, longer for rate limits
      const wait = Math.min(20000, 1500 * 2 ** attempt);
      await sleep(wait);
    }
  }
  return [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function cleanDescription(about: string): string {
  return about
    .replace(/Make sure this fits by entering your model number\.?/gi, "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(". ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

function parsePrice(v: unknown): number | undefined {
  const n = parseFloat(str(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function normalize(row: Row, idx: number): Product | null {
  const title = str(row["Product Name"]).trim();
  if (!title) return null;

  const catPath = str(row["Category"])
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  const category = catPath[0] || undefined;
  const tags = catPath.slice(1, 5); // deeper category segments help semantic + keyword recall

  const description = cleanDescription(str(row["About Product"]));
  const brand = str(row["Brand Name"]).trim();

  const product: Product = {
    id: idx + 1,
    title: title.slice(0, 200),
    description,
    category,
    tags: tags.length ? tags : undefined,
    price: parsePrice(row["Selling Price"]),
  };
  if (brand) product.brand = brand;
  return product;
}

async function main(): Promise<void> {
  console.log(`Fetching ${TARGET} products from HF dataset "${DATASET}" ...`);
  const products: Product[] = [];
  for (let offset = 0; offset < TARGET; offset += PAGE) {
    const rows = await fetchPage(offset);
    if (rows.length === 0) break;
    rows.forEach((row, i) => {
      const p = normalize(row, offset + i);
      if (p) products.push(p);
    });
    process.stdout.write(`\r  fetched ${products.length} products   `);
    await sleep(250); // be polite to the public API to avoid rate limits
  }
  // Re-id sequentially so ids are dense after dropping empties.
  products.forEach((p, i) => (p.id = i + 1));

  await writeFile(OUT, JSON.stringify(products), "utf8");
  const withPrice = products.filter((p) => p.price != null).length;
  const withDesc = products.filter((p) => (p.description ?? "").length > 0).length;
  console.log(
    `\nWrote ${products.length} products -> ${OUT}\n` +
      `  with price: ${withPrice} · with description: ${withDesc}`,
  );
}

main().catch((err) => {
  console.error(`\nfetch: ${err.message}`);
  process.exit(1);
});

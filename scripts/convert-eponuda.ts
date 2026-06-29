/**
 * Convert an eponuda-format product feed (e.g. https://it-shop.rs/eponuda.xml)
 * into PragmaSearch's product JSON. Builds a rich Serbian text field for
 * embeddings from the product description + attribute key/value pairs.
 *
 * Run: npx tsx scripts/convert-eponuda.ts [input.xml] [output.json]
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { Product } from "../src/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p: string) => (isAbsolute(p) ? p : join(ROOT, p));

const INPUT = rel(process.argv[2] ?? "data/eponuda.xml");
const OUTPUT = rel(process.argv[3] ?? "data/products-itshop.json");

function txt(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>)["#text"]).trim();
  }
  return "";
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

interface RawAttr {
  key?: unknown;
  value?: unknown;
}
interface RawProduct {
  sku?: unknown;
  product_ean?: unknown;
  product_name?: unknown;
  product_description?: unknown;
  product_category?: unknown;
  product_brand?: unknown;
  product_price?: unknown;
  product_url?: unknown;
  product_image_urls?: { product_image_url?: unknown };
  attributes?: { attribute?: RawAttr | RawAttr[] };
}

function normalize(raw: RawProduct, idx: number): Product | null {
  const title = txt(raw.product_name);
  if (!title) return null;

  const attrText = asArray(raw.attributes?.attribute)
    .map((a) => `${txt(a.key)}: ${txt(a.value)}`)
    .filter((s) => s.length > 2)
    .join(". ");

  const description = [txt(raw.product_description), attrText]
    .filter(Boolean)
    .join(". ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);

  const catPath = txt(raw.product_category)
    .split(">")
    .map((s) => s.trim())
    .filter(Boolean);
  const category = catPath[catPath.length - 1] || undefined;
  const tags = catPath.slice(0, -1).slice(0, 4);

  const imgs = asArray(raw.product_image_urls?.product_image_url);
  const price = Number(txt(raw.product_price));

  const product: Product = {
    id: txt(raw.sku) || txt(raw.product_ean) || String(idx + 1),
    title: title.slice(0, 250),
    description,
    category,
    tags: tags.length ? tags : undefined,
  };
  if (Number.isFinite(price) && price > 0) {
    product.price = price;
    product.currency = "RSD";
  }
  const brand = txt(raw.product_brand);
  if (brand) product.brand = brand;
  const url = txt(raw.product_url);
  if (url) product.url = url;
  const image = txt(imgs[0]);
  if (image) product.image = image;
  return product;
}

async function main(): Promise<void> {
  console.log(`Parsing ${INPUT} ...`);
  const xml = await readFile(INPUT, "utf8");
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true,
  });
  const parsed = parser.parse(xml) as { products?: { product?: RawProduct | RawProduct[] } };
  const raw = asArray(parsed.products?.product);
  console.log(`  ${raw.length} raw products`);

  const products: Product[] = [];
  raw.forEach((r, i) => {
    const p = normalize(r, i);
    if (p) products.push(p);
  });

  await writeFile(OUTPUT, JSON.stringify(products), "utf8");
  const withDesc = products.filter((p) => (p.description ?? "").length > 20).length;
  const withPrice = products.filter((p) => p.price != null).length;
  console.log(
    `Wrote ${products.length} products -> ${OUTPUT}\n` +
      `  with description: ${withDesc} · with price: ${withPrice}`,
  );
}

main().catch((err) => {
  console.error(`convert: ${err.message}`);
  process.exit(1);
});

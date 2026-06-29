/**
 * Minimal end-to-end example. Mirrors the README snippet so it stays honest.
 * Run: npx tsx examples/quickstart.ts   (downloads the ~23MB model on first run)
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildIndex, createSearcher, type Product } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const products: Product[] = JSON.parse(
    await readFile(join(here, "products.sample.json"), "utf8"),
  );

  // 1. Index your catalog once.
  const index = await buildIndex(products);

  // 2. Search it — by meaning, not just keywords.
  const searcher = await createSearcher(index);
  for (const q of ["something for gaming", "make coffee at home"]) {
    const hits = await searcher.search(q, 3);
    console.log(`\n"${q}"`);
    for (const h of hits) {
      console.log(`  ${h.score.toFixed(3)}  ${h.product.title}  [${(h.signals ?? []).join("+")}]`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

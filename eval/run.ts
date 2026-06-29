/**
 * Evaluation harness. Measures retrieval quality of each search mode against a
 * small labelled query set, so we can tell whether a change actually helps
 * instead of eyeballing it.
 *
 * Run:  npm run eval   (or: npx tsx eval/run.ts)
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createSearcher } from "../src/search.js";
import { loadIndex } from "../src/storage.js";
import type { SearchMode } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

interface LabelledQuery {
  q: string;
  relevant: number[];
}

const K = 5; // evaluate the top-5

function ndcgAtK(rankedIds: string[], relevant: Set<string>, k: number): number {
  let dcg = 0;
  for (let i = 0; i < Math.min(k, rankedIds.length); i++) {
    if (relevant.has(rankedIds[i])) dcg += 1 / Math.log2(i + 2);
  }
  let idcg = 0;
  for (let i = 0; i < Math.min(k, relevant.size); i++) idcg += 1 / Math.log2(i + 2);
  return idcg > 0 ? dcg / idcg : 0;
}

function recallAtK(rankedIds: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0;
  let hit = 0;
  for (const id of rankedIds.slice(0, k)) if (relevant.has(id)) hit++;
  return hit / relevant.size;
}

function reciprocalRank(rankedIds: string[], relevant: Set<string>): number {
  for (let i = 0; i < rankedIds.length; i++) {
    if (relevant.has(rankedIds[i])) return 1 / (i + 1);
  }
  return 0;
}

function pct(x: number): string {
  return (x * 100).toFixed(1).padStart(5);
}

async function main(): Promise<void> {
  const index = await loadIndex(join(ROOT, "pragmasearch-index.json"));
  const queries: LabelledQuery[] = JSON.parse(
    await readFile(join(__dirname, "queries.json"), "utf8"),
  );
  const searcher = await createSearcher(index);

  const modes: SearchMode[] = ["vector", "keyword", "hybrid"];
  console.log(
    `\nPragmaSearch eval · ${queries.length} queries · ${index.meta.count} products · ` +
      `model ${index.meta.model} (${index.meta.dtype}) · @${K}\n`,
  );
  console.log(`  mode      nDCG@${K}  Recall@${K}   MRR`);
  console.log("  " + "-".repeat(38));

  const perQuery: Record<string, Record<SearchMode, number>> = {};

  for (const mode of modes) {
    let nd = 0;
    let rc = 0;
    let mrr = 0;
    for (const item of queries) {
      const relevant = new Set(item.relevant.map(String));
      const results = await searcher.search(item.q, Math.max(K, 10), { mode });
      const rankedIds = results.map((r) => String(r.id));
      const ndcg = ndcgAtK(rankedIds, relevant, K);
      nd += ndcg;
      rc += recallAtK(rankedIds, relevant, K);
      mrr += reciprocalRank(rankedIds, relevant);
      (perQuery[item.q] ??= {} as Record<SearchMode, number>)[mode] = reciprocalRank(
        rankedIds,
        relevant,
      );
    }
    const n = queries.length;
    console.log(
      `  ${mode.padEnd(8)} ${pct(nd / n)}%   ${pct(rc / n)}%   ${pct(mrr / n)}%`,
    );
  }

  // Highlight where hybrid changes the top hit vs pure vector (exact-match wins, etc.).
  console.log("\n  Queries where hybrid beats vector (MRR delta):");
  let shown = 0;
  for (const item of queries) {
    const v = perQuery[item.q].vector ?? 0;
    const h = perQuery[item.q].hybrid ?? 0;
    if (h - v > 0.001) {
      console.log(
        `    + "${item.q}"  vector MRR ${v.toFixed(2)} -> hybrid ${h.toFixed(2)}`,
      );
      shown++;
    }
  }
  if (shown === 0) console.log("    (none)");

  console.log("\n  Queries where hybrid is worse than vector:");
  let worse = 0;
  for (const item of queries) {
    const v = perQuery[item.q].vector ?? 0;
    const h = perQuery[item.q].hybrid ?? 0;
    if (v - h > 0.001) {
      console.log(
        `    - "${item.q}"  vector MRR ${v.toFixed(2)} -> hybrid ${h.toFixed(2)}`,
      );
      worse++;
    }
  }
  if (worse === 0) console.log("    (none)");
  console.log("");
}

main().catch((err) => {
  console.error(`eval: ${err.message}`);
  process.exit(1);
});

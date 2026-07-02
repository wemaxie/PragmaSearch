#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { readFile, stat } from "node:fs/promises";
import { buildIndex } from "./index-builder.js";
import { createSearcher } from "./search.js";
import { signSearchToken } from "./tokens.js";
import { readProducts, saveIndex, loadIndex } from "./storage.js";
import type { SynonymOptions } from "./synonyms.js";
import type { RankingRules } from "./ranking.js";
import type { SearchMode, Filter } from "./types.js";

const DEFAULT_INDEX_FILE = "pragmasearch-index.json";

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

/** Minimal flag parser: `--key value`, `--key=value`, `--bool`, and `-k 5`. */
function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const body = a.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
        flags[body] = argv[++i];
      } else {
        flags[body] = true;
      }
    } else if (a === "-k") {
      if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) flags.k = argv[++i];
      else flags.k = true; // missing value — validated later
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

/** A flag that must carry a string value (errors if it was passed as a bare boolean flag). */
function strFlag(flags: ParsedArgs["flags"], name: string): string | undefined {
  const v = flags[name];
  if (v === undefined) return undefined;
  if (v === true) throw new Error(`--${name} expects a value`);
  return v as string;
}

/** Read a flag that names a JSON file and parse it; undefined if the flag is absent. */
async function readJsonFlag<T>(flags: ParsedArgs["flags"], name: string): Promise<T | undefined> {
  const file = strFlag(flags, name);
  if (!file) return undefined;
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (e) {
    throw new Error(`--${name}: could not read/parse ${file}: ${(e as Error).message}`);
  }
}

/** Parse `-k`: a positive integer or throw. */
function intFlag(flags: ParsedArgs["flags"], name: string, dflt: number): number {
  const v = flags[name];
  if (v === undefined) return dflt;
  if (typeof v !== "string" || !/^\d+$/.test(v) || Number(v) < 1) {
    throw new Error(`-${name} expects a positive integer, got ${JSON.stringify(v)}`);
  }
  return Number(v);
}

function usage(): void {
  console.log(`
PragmaSearch — local-first semantic search. No cloud, no API keys, $0.

Usage:
  pragmasearch index <products.json> [--out <file>] [--model <id>] [--dtype <q8|fp32>] [--searchable <fields>] [--compact]
  pragmasearch search <query...> [--index <file>] [-k <n>] [--mode <hybrid|vector|keyword>] [--typo <on|off>] [--synonyms <file.json>] [--rules <file.json>]
  pragmasearch token --secret <s> [--filter '<json>'] [--exp <seconds>]

  --searchable  comma-separated fields with optional ^weight, e.g.
                "title^3,description,brand^2,tags" (default: title^2,description,category,tags)

Examples:
  pragmasearch index data/products.json
  pragmasearch index data/products.json --searchable "title^3,brand^2,description,tags" --compact
  pragmasearch search "something for gaming" -k 5
  pragmasearch search "RTX 4070" --mode hybrid
  pragmasearch search "opple airpods" --typo on
  pragmasearch token --secret s3cret --filter '{"tenant":"acme"}' --exp 3600
`);
}

async function cmdIndex(args: ParsedArgs): Promise<void> {
  const input = args.positionals[0];
  if (!input) {
    usage();
    throw new Error("index: missing <products.json>");
  }
  const compact = args.flags.compact === true;
  const out = strFlag(args.flags, "out") ?? (compact ? `${DEFAULT_INDEX_FILE}.gz` : DEFAULT_INDEX_FILE);
  const model = strFlag(args.flags, "model");
  const dtype = strFlag(args.flags, "dtype");
  const searchableFlag = strFlag(args.flags, "searchable");
  // "title^3,description,brand^2" -> ["title^3","description","brand^2"]; searchable.ts parses the ^weight.
  const searchableAttributes = searchableFlag
    ? searchableFlag.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  const products = await readProducts(input);
  console.log(`Indexing ${products.length} products from ${input} ...`);

  const t0 = performance.now();
  const index = await buildIndex(products, {
    model,
    dtype,
    searchableAttributes,
    onProgress: (e: any) => {
      if (e?.status === "progress" && e?.file?.endsWith?.(".onnx")) {
        process.stdout.write(
          `\r  downloading ${e.file} ${Math.round(e.progress ?? 0)}%   `,
        );
      }
    },
    onBatch: (done, total) => {
      process.stdout.write(`\r  embedded ${done}/${total}   `);
    },
  });
  const secs = ((performance.now() - t0) / 1000).toFixed(1);

  await saveIndex(out, index, { compact });
  const { size } = await stat(out);
  const fields = (index.meta.searchableAttributes ?? [])
    .map((a) => (a.weight === 1 ? a.field : `${a.field}^${a.weight}`))
    .join(", ");
  console.log(
    `\nDone. model=${index.meta.model} dim=${index.meta.dim} dtype=${index.meta.dtype} ` +
      `items=${index.meta.count} in ${secs}s -> ${out} (${(size / 1024 / 1024).toFixed(2)} MB${compact ? ", compact int8+gzip" : ""})` +
      (fields ? `\n  searchable: ${fields}` : ""),
  );
}

async function cmdSearch(args: ParsedArgs): Promise<void> {
  const query = args.positionals.join(" ").trim();
  if (!query) {
    usage();
    throw new Error("search: missing <query>");
  }
  const indexFile = strFlag(args.flags, "index") ?? DEFAULT_INDEX_FILE;
  const k = intFlag(args.flags, "k", 10);
  const modeFlag = strFlag(args.flags, "mode");
  if (modeFlag && !["hybrid", "vector", "keyword"].includes(modeFlag)) {
    throw new Error(`--mode must be hybrid|vector|keyword, got ${JSON.stringify(modeFlag)}`);
  }
  const mode = (modeFlag as SearchMode | undefined) ?? "hybrid";
  // --typo off  (or --no-typo) disables typo tolerance; default on.
  const typo = strFlag(args.flags, "typo") === "off" || args.flags["no-typo"] === true ? false : true;

  // --synonyms <file.json>: { groups?: string[][], oneWay?: {from,to[]}[], weight? }
  const synonyms = await readJsonFlag<SynonymOptions>(args.flags, "synonyms");
  // --rules <file.json>: { boost?: [...], bury?: [...], pin?: [...] }
  const rankingRules = await readJsonFlag<RankingRules>(args.flags, "rules");

  const index = await loadIndex(indexFile);
  const searcher = await createSearcher(index, { synonyms, rankingRules });

  const t0 = performance.now();
  const { hits, total } = await searcher.search(query, k, { mode, typo });
  const ms = (performance.now() - t0).toFixed(1);

  console.log(
    `\nQuery: "${query}"   (${mode}, ${ms} ms, ${total} of ${index.meta.count} items)\n`,
  );
  hits.forEach((r, i) => {
    const cur = r.product.currency as string | undefined;
    const price =
      r.product.price != null
        ? cur
          ? `  ${r.product.price} ${cur}`
          : `  $${r.product.price}`
        : "";
    const via = r.signals?.length ? `  [${r.signals.join("+")}]` : "";
    console.log(
      `${String(i + 1).padStart(2)}. ${r.score.toFixed(3)}  ${r.product.title}${price}${via}`,
    );
  });
  console.log("");
}

function cmdToken(args: ParsedArgs): void {
  const secret = strFlag(args.flags, "secret") ?? process.env.PRAGMA_SEARCH_SECRET;
  if (!secret) {
    usage();
    throw new Error("token: --secret <s> (or PRAGMA_SEARCH_SECRET) is required");
  }
  const filterStr = strFlag(args.flags, "filter");
  let filter: Record<string, unknown> | undefined;
  if (filterStr) {
    try {
      filter = JSON.parse(filterStr);
    } catch (e) {
      throw new Error(`token: --filter must be valid JSON: ${(e as Error).message}`);
    }
  }
  const expStr = strFlag(args.flags, "exp");
  const exp = expStr ? Math.floor(Date.now() / 1000) + intFlag({ exp: expStr }, "exp", 0) : undefined;
  console.log(signSearchToken({ filter: filter as Filter | undefined, exp }, secret));
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  const args = parseArgs(rest);

  switch (cmd) {
    case "token":
      cmdToken(args);
      break;
    case "index":
      await cmdIndex(args);
      break;
    case "search":
      await cmdSearch(args);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      usage();
      break;
    default:
      usage();
      throw new Error(`unknown command: ${cmd}`);
  }
}

main().catch((err) => {
  console.error(`\npragmasearch: ${err.message}`);
  process.exit(1);
});

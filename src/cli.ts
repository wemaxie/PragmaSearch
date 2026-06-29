#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { buildIndex } from "./index-builder.js";
import { createSearcher } from "./search.js";
import { readProducts, saveIndex, loadIndex } from "./storage.js";
import type { SearchMode } from "./types.js";

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
      flags.k = argv[++i];
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

function usage(): void {
  console.log(`
PragmaSearch — local-first semantic search. No cloud, no API keys, $0.

Usage:
  pragmasearch index <products.json> [--out <file>] [--model <id>] [--dtype <q8|fp32>]
  pragmasearch search <query...> [--index <file>] [-k <n>] [--mode <hybrid|vector|keyword>] [--typo <on|off>]

Examples:
  pragmasearch index data/products.json
  pragmasearch search "something for gaming" -k 5
  pragmasearch search "RTX 4070" --mode hybrid
  pragmasearch search "opple airpods" --typo on
`);
}

async function cmdIndex(args: ParsedArgs): Promise<void> {
  const input = args.positionals[0];
  if (!input) {
    usage();
    throw new Error("index: missing <products.json>");
  }
  const out = (args.flags.out as string) ?? DEFAULT_INDEX_FILE;
  const model = args.flags.model as string | undefined;
  const dtype = args.flags.dtype as string | undefined;

  const products = await readProducts(input);
  console.log(`Indexing ${products.length} products from ${input} ...`);

  const t0 = performance.now();
  const index = await buildIndex(products, {
    model,
    dtype,
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

  await saveIndex(out, index);
  console.log(
    `\nDone. model=${index.meta.model} dim=${index.meta.dim} dtype=${index.meta.dtype} ` +
      `items=${index.meta.count} in ${secs}s -> ${out}`,
  );
}

async function cmdSearch(args: ParsedArgs): Promise<void> {
  const query = args.positionals.join(" ").trim();
  if (!query) {
    usage();
    throw new Error("search: missing <query>");
  }
  const indexFile = (args.flags.index as string) ?? DEFAULT_INDEX_FILE;
  const k = args.flags.k ? Number(args.flags.k) : 10;
  const mode = (args.flags.mode as SearchMode | undefined) ?? "hybrid";
  // --typo off  (or --no-typo) disables typo tolerance; default on.
  const typo = args.flags.typo === "off" || args.flags["no-typo"] === true ? false : true;

  const index = await loadIndex(indexFile);
  const searcher = await createSearcher(index);

  const t0 = performance.now();
  const results = await searcher.search(query, k, { mode, typo });
  const ms = (performance.now() - t0).toFixed(1);

  console.log(
    `\nQuery: "${query}"   (${mode}, ${ms} ms, ${index.meta.count} items)\n`,
  );
  results.forEach((r, i) => {
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

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  const args = parseArgs(rest);

  switch (cmd) {
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

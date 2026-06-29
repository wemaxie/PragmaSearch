/**
 * Pre-download an embedding model into the cache so a deployed server's first
 * request is fast (no cold-start download). Run during `docker build`.
 * Self-contained (no src imports) so its Docker layer caches across code changes.
 *
 * Usage: npx tsx scripts/prewarm.ts [model] [dtype]
 */
import { pipeline, env } from "@huggingface/transformers";

if (process.env.PRAGMA_MODEL_CACHE) {
  env.cacheDir = process.env.PRAGMA_MODEL_CACHE;
}

const model = process.argv[2] ?? "Xenova/multilingual-e5-small";
const dtype = process.argv[3] ?? "q8";

async function main(): Promise<void> {
  console.log(`Pre-warming ${model} (${dtype}) into ${env.cacheDir ?? "default cache"} ...`);
  const extractor: any = await pipeline("feature-extraction", model, { dtype } as any);
  await extractor(["warm up"], { pooling: "mean", normalize: true });
  console.log(`Pre-warm done: ${model}`);
}

main().catch((err) => {
  console.error(`prewarm: ${err.message}`);
  process.exit(1);
});

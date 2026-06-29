/**
 * Pre-download an embedding model into the local cache so a deployed server's
 * first request is fast (no cold-start model download). Run during `docker build`.
 *
 * Usage: npx tsx scripts/prewarm.ts [model] [dtype]
 */
import { createEmbedder } from "../src/embedder.js";

const model = process.argv[2] ?? "Xenova/multilingual-e5-small";
const dtype = process.argv[3] ?? "q8";

async function main(): Promise<void> {
  console.log(`Pre-warming ${model} (${dtype}) into ${process.env.PRAGMA_MODEL_CACHE ?? "default cache"} ...`);
  const embedder = await createEmbedder({
    model,
    dtype,
    onProgress: (e: any) => {
      if (e?.status === "progress" && typeof e?.progress === "number" && e.progress % 25 < 1) {
        process.stdout.write(`\r  ${e.file ?? ""} ${Math.round(e.progress)}%   `);
      }
    },
  });
  // touch the model once so the graph is fully materialized/cached
  await embedder.embedOne("warm up");
  console.log(`\nPre-warm done: ${model}`);
}

main().catch((err) => {
  console.error(`prewarm: ${err.message}`);
  process.exit(1);
});

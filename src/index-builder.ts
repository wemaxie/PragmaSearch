import { createEmbedder, docPrefix, type EmbedderOptions } from "./embedder.js";
import type { Product, PragmaIndex, IndexItem } from "./types.js";

export const INDEX_FORMAT_VERSION = 1;

/** Round to 4 decimals — shrinks the index file ~2x with no meaningful recall loss on normalized vectors. */
function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

/**
 * The text we actually embed for a product. We DON'T just embed the title —
 * description, category and tags carry the meaning that makes "for gaming"
 * match an "RTX 5090". Documents get NO prefix (correct for all-MiniLM).
 */
export function productText(p: Product): string {
  return [p.title, p.description, p.category, (p.tags ?? []).join(" ")]
    .filter((s) => typeof s === "string" && s.trim().length > 0)
    .join(". ");
}

export interface BuildIndexOptions extends EmbedderOptions {
  /** Batch size for embedding. Keeps memory bounded on large catalogs. */
  batchSize?: number;
  /** Called after each batch with (done, total) for progress reporting. */
  onBatch?: (done: number, total: number) => void;
}

/** Embed every product and assemble the in-memory index. */
export async function buildIndex(
  products: Product[],
  opts: BuildIndexOptions = {},
): Promise<PragmaIndex> {
  if (products.length === 0) {
    throw new Error("buildIndex: no products to index");
  }
  const batchSize = opts.batchSize ?? 64;
  const embedder = await createEmbedder(opts);
  const prefix = docPrefix(embedder.model);

  const items: IndexItem[] = [];
  for (let start = 0; start < products.length; start += batchSize) {
    const batch = products.slice(start, start + batchSize);
    const vectors = await embedder.embed(batch.map((p) => prefix + productText(p)));
    for (let i = 0; i < batch.length; i++) {
      items.push({
        id: batch[i].id,
        vector: vectors[i].map(round4),
        payload: batch[i],
      });
    }
    opts.onBatch?.(Math.min(start + batchSize, products.length), products.length);
  }

  return {
    meta: {
      version: INDEX_FORMAT_VERSION,
      model: embedder.model,
      dtype: embedder.dtype,
      dim: embedder.dim,
      pooling: "mean",
      normalize: true,
      count: items.length,
      builtAt: new Date().toISOString(),
    },
    items,
  };
}

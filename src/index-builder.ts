import { createEmbedder, docPrefix, type EmbedderOptions } from "./embedder.js";
import { productText, resolveSearchable } from "./searchable.js";
import type { Product, PragmaIndex, IndexItem, SearchableAttribute } from "./types.js";

export const INDEX_FORMAT_VERSION = 1;

// Re-exported for back-compat: `productText` now lives in ./searchable so it can
// be shared (config-aware) by the builder, incremental upserts and the searcher.
export { productText } from "./searchable.js";

/** Round to 4 decimals — shrinks the index file ~2x with no meaningful recall loss on normalized vectors. */
function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

export interface BuildIndexOptions extends EmbedderOptions {
  /** Batch size for embedding. Keeps memory bounded on large catalogs. */
  batchSize?: number;
  /** Called after each batch with (done, total) for progress reporting. */
  onBatch?: (done: number, total: number) => void;
  /**
   * Which product fields to make searchable + their weights. Default:
   * `title^2, description, category, tags`. Governs both the embedded text and
   * the BM25 layer, and is stored in the index so query time uses the same config.
   */
  searchableAttributes?: SearchableAttribute[];
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
  const attrs = resolveSearchable(opts.searchableAttributes);
  const embedder = await createEmbedder(opts);
  const prefix = docPrefix(embedder.model);

  const items: IndexItem[] = [];
  for (let start = 0; start < products.length; start += batchSize) {
    const batch = products.slice(start, start + batchSize);
    const vectors = await embedder.embed(batch.map((p) => prefix + productText(p, attrs)));
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
      searchableAttributes: attrs,
      builtAt: new Date().toISOString(),
    },
    items,
  };
}

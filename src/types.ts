/**
 * Core data shapes for PragmaSearch.
 *
 * A product is whatever the consumer puts in their JSON — we only require an
 * `id` and a `title`; everything else is carried through untouched as payload.
 */
export interface Product {
  id: string | number;
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
  price?: number;
  image?: string;
  [key: string]: unknown;
}

/** Metadata stored alongside the index so the query encoder always matches the index encoder. */
export interface IndexMeta {
  /** PragmaSearch index format version. */
  version: number;
  /** HF model id used to embed (e.g. "Xenova/all-MiniLM-L6-v2"). */
  model: string;
  /** Quantization dtype used at index time (e.g. "q8", "fp32"). */
  dtype: string;
  /** Embedding dimension (e.g. 384). */
  dim: number;
  /** Pooling strategy — always mean for the sentence models we use. */
  pooling: "mean";
  /** Whether vectors were L2-normalized (so cosine == dot product). */
  normalize: boolean;
  /** Number of indexed items. */
  count: number;
  /** ISO timestamp the index was built. */
  builtAt: string;
}

/** One indexed product: its embedding plus the original record. */
export interface IndexItem {
  id: string | number;
  vector: number[];
  payload: Product;
}

/** The complete on-disk index artifact. */
export interface PragmaIndex {
  meta: IndexMeta;
  items: IndexItem[];
}

/** Which retrieval signal(s) surfaced a hit. */
export type SearchSignal = "vector" | "keyword" | "exact";

/** Search strategy. Hybrid (default) fuses vector + keyword; the others isolate one layer. */
export type SearchMode = "hybrid" | "vector" | "keyword";

/** A single search hit. */
export interface SearchResult {
  id: string | number;
  /**
   * Final ranking score. For `vector` mode this is cosine (0..1); for `hybrid`
   * it's the fused RRF score (small absolute values — compare relative, not absolute).
   */
  score: number;
  product: Product;
  /** Which layers matched, for transparency in UIs/debugging. */
  signals?: SearchSignal[];
}

import { createEmbedder, queryPrefix, type Embedder } from "./embedder.js";
import {
  buildKeywordIndex,
  rrfFuse,
  exactTitleMatches,
  type KeywordIndex,
  type TypoOptions,
} from "./hybrid.js";
import type {
  PragmaIndex,
  SearchResult,
  SearchMode,
  SearchSignal,
  IndexItem,
} from "./types.js";

/** Dot product. For L2-normalized vectors this equals cosine similarity. */
function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Brute-force vector search: score every item by cosine, return the top K.
 * For 5k–10k×384 this is sub-millisecond, so the MVP needs no vector DB.
 */
export function searchVectors(
  index: PragmaIndex,
  queryVector: number[],
  k = 10,
): SearchResult[] {
  if (queryVector.length !== index.meta.dim) {
    throw new Error(
      `query vector dim ${queryVector.length} != index dim ${index.meta.dim}`,
    );
  }
  const scored: SearchResult[] = index.items.map((item) => ({
    id: item.id,
    score: dot(queryVector, item.vector),
    product: item.payload,
    signals: ["vector"] as SearchSignal[],
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

const DEFAULT_POOL = 50; // candidates pulled from each layer before fusion
const DEFAULT_RRF_K = 60;
const EXACT_BOOST = 1.0; // dominant: a verbatim title match should win outright

export interface SearchOptions {
  /** "hybrid" (default) fuses vector + keyword; "vector" / "keyword" isolate one layer. */
  mode?: SearchMode;
  /** RRF damping constant. */
  rrfK?: number;
  /** How many candidates to pull from each layer before fusing. */
  pool?: number;
  /**
   * Typo tolerance for the keyword layer: `true` (default) / `false`, or a config
   * object ({ minLength, secondTypoLength, penalty }). Lets "opple" match "apple".
   */
  typo?: boolean | TypoOptions;
}

export interface Searcher {
  search(query: string, k?: number, opts?: SearchOptions): Promise<SearchResult[]>;
  index: PragmaIndex;
  embedder: Embedder;
  keyword: KeywordIndex;
}

/**
 * Load a searcher over an in-memory index. Reuses the SAME model the index was
 * built with (from index.meta) so query and document vectors are comparable,
 * and builds the keyword (BM25) layer in memory for hybrid search.
 */
export async function createSearcher(index: PragmaIndex): Promise<Searcher> {
  const embedder = await createEmbedder({
    model: index.meta.model,
    dtype: index.meta.dtype,
  });
  const keyword = buildKeywordIndex(index.items);
  const byId = new Map<string, IndexItem>(
    index.items.map((it) => [String(it.id), it]),
  );

  async function search(
    query: string,
    k = 10,
    opts: SearchOptions = {},
  ): Promise<SearchResult[]> {
    const q = query.trim();
    if (!q) return [];

    const mode = opts.mode ?? "hybrid";
    const pool = opts.pool ?? DEFAULT_POOL;
    const rrfK = opts.rrfK ?? DEFAULT_RRF_K;

    // Keyword-only mode: no embedding needed.
    if (mode === "keyword") {
      return keyword.search(q, k, opts.typo).map((h) => {
        const item = byId.get(h.id)!;
        return {
          id: item.payload.id,
          score: h.score,
          product: item.payload,
          signals: ["keyword"] as SearchSignal[],
        };
      });
    }

    const queryVector = await embedder.embedOne(queryPrefix(index.meta.model) + q);

    if (mode === "vector") {
      return searchVectors(index, queryVector, k);
    }

    // Hybrid: fuse vector + keyword rankings with RRF, then boost exact title matches.
    const vIds = searchVectors(index, queryVector, pool).map((r) => String(r.id));
    const kIds = keyword.search(q, pool, opts.typo).map((h) => h.id);
    const fused = rrfFuse([vIds, kIds], rrfK);

    const exact = exactTitleMatches(q, index.items);
    for (const id of exact) fused.set(id, (fused.get(id) ?? 0) + EXACT_BOOST);

    const vSet = new Set(vIds);
    const kSet = new Set(kIds);

    const results: SearchResult[] = [...fused.entries()].map(([id, score]) => {
      const item = byId.get(id)!;
      const signals: SearchSignal[] = [];
      if (vSet.has(id)) signals.push("vector");
      if (kSet.has(id)) signals.push("keyword");
      if (exact.has(id)) signals.push("exact");
      return { id: item.payload.id, score, product: item.payload, signals };
    });
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  return { search, index, embedder, keyword };
}

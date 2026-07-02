import { createEmbedder, queryPrefix, docPrefix, type Embedder } from "./embedder.js";
import { INDEX_FORMAT_VERSION, productText } from "./index-builder.js";
import {
  buildKeywordIndex,
  rrfFuse,
  exactTitleMatches,
  resolveTokenizer,
  type KeywordIndex,
  type TypoOptions,
  type SynonymExpander,
  type Tokenizer,
  type TokenizerOptions,
} from "./hybrid.js";
import { matchesFilter, computeFacets } from "./facets.js";
import { buildSynonyms, type SynonymOptions } from "./synonyms.js";
import { applyRankingRules, type RankingRules } from "./ranking.js";
import { resolveSearchable } from "./searchable.js";
import { planUpsert, applyUpsert, removeItems, patchPayload, round4 } from "./incremental.js";
import { highlightProduct, type HighlightOptions } from "./highlight.js";
import type {
  PragmaIndex,
  SearchResult,
  SearchMode,
  SearchSignal,
  Product,
  IndexItem,
  Filter,
  SearchResponse,
} from "./types.js";

/**
 * Cosine score (dot product for L2-normalized vectors). A length mismatch (only
 * possible from a hand-corrupted index) sorts cleanly last instead of injecting
 * a NaN score that would scramble the ordering.
 */
function dot(a: number[], b: number[]): number {
  if (a.length !== b.length) return -Infinity;
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
  // Clamp k like the internal search() does, so a negative/NaN k from an external
  // caller can't slice from the end or truncate surprisingly.
  const limit = Number.isFinite(k) ? Math.max(0, Math.floor(k)) : 10;
  const scored: SearchResult[] = index.items.map((item) => ({
    id: item.id,
    score: dot(queryVector, item.vector),
    product: item.payload,
    signals: ["vector"] as SearchSignal[],
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

const DEFAULT_RRF_K = 60;
const EXACT_BOOST = 1.0; // dominant: a verbatim title match should win outright

export interface SearchOptions {
  /** "hybrid" (default) fuses vector + keyword; "vector" / "keyword" isolate one layer. */
  mode?: SearchMode;
  /** RRF damping constant. */
  rrfK?: number;
  /**
   * Typo tolerance for the keyword layer: `true` (default) / `false`, or a config
   * object ({ minLength, secondTypoLength, penalty }). Lets "opple" match "apple".
   */
  typo?: boolean | TypoOptions;
  /** Restrict results to products matching this filter (e.g. `{ category: "Laptops", price: { lte: 1000 } }`). */
  filter?: Filter;
  /** Fields to compute facet (value→count) buckets for over the filtered set. */
  facets?: string[];
  /** Max facet values returned per field (default 20). */
  maxFacetValues?: number;
  /** Pagination offset into the ranked result set (default 0). */
  offset?: number;
  /** Highlight matching words in result fields: `true` (title+description) or a config object. */
  highlight?: boolean | HighlightOptions;
  /**
   * Merchandising rules (boost / bury / pin) applied after ranking, for this query.
   * Overrides the searcher-level default when set. See {@link RankingRules}.
   */
  rankingRules?: RankingRules;
}

/** Result of an incremental update. */
export interface UpsertResult {
  /** New items added. */
  added: number;
  /** Existing items updated (re-embedded text-change + payload-only swaps). */
  updated: number;
  /** How many actually went through the model (the delta that needed a vector). */
  reembedded: number;
}

export interface Searcher {
  /** Run a search and return a page of hits plus totals + facet counts. */
  search(query: string, k?: number, opts?: SearchOptions): Promise<SearchResponse>;

  /**
   * Patch payload fields (price, stock, ...) on existing items WITHOUT re-embedding.
   * Cheap, no model call. Use for the high-frequency, text-unchanged updates.
   * Returns the number patched. Persist with `saveIndex(searcher.index)` afterwards.
   */
  patchPayload(patches: { id: string | number; fields: Partial<Product> }[]): number;

  /**
   * Add or update products. Only new/text-changed products are embedded (the delta);
   * text-unchanged ones keep their vector and just swap payload. Rebuilds the keyword index.
   */
  upsert(products: Product[]): Promise<UpsertResult>;

  /** Remove items by id. Rebuilds the keyword index. Returns the number removed. */
  remove(ids: (string | number)[]): number;

  index: PragmaIndex;
  embedder: Embedder;
  keyword: KeywordIndex;
}

/** Options for {@link createSearcher}. */
export interface SearcherOptions {
  /**
   * Synonyms applied as query expansion in the keyword layer (multi-way `groups`
   * and directional `oneWay`). See {@link SynonymOptions}.
   */
  synonyms?: SynonymOptions;
  /**
   * Default merchandising rules (boost / bury / pin) applied to every query. A
   * per-query `SearchOptions.rankingRules` overrides this. See {@link RankingRules}.
   */
  rankingRules?: RankingRules;
  /**
   * Tokenizer for the keyword layer: a preset name (`"english"` default,
   * `"minimal"` for non-English), `{ stopwords, stem }`, or a function. Applies to
   * BM25 indexing, query parsing, synonyms and highlighting consistently.
   */
  tokenizer?: string | TokenizerOptions | Tokenizer;
}

/**
 * Load a searcher over an in-memory index. Reuses the SAME model the index was
 * built with (from index.meta) so query and document vectors are comparable,
 * and builds the keyword (BM25) layer in memory for hybrid search.
 */
export async function createSearcher(
  index: PragmaIndex,
  opts: SearcherOptions = {},
): Promise<Searcher> {
  const meta = index.meta;
  // Fail loudly on a malformed/incompatible index instead of silently returning garbage rankings.
  if (typeof meta?.model !== "string" || !meta.model || typeof meta.dtype !== "string" || !meta.dtype) {
    throw new Error(
      "PragmaSearch: index meta is missing model/dtype — rebuild it with this version of the indexer.",
    );
  }
  if (meta.version !== INDEX_FORMAT_VERSION) {
    throw new Error(
      `PragmaSearch: index format v${meta.version} != supported v${INDEX_FORMAT_VERSION}. Rebuild the index.`,
    );
  }

  const embedder = await createEmbedder({ model: meta.model, dtype: meta.dtype });

  // Probe once: the query encoder MUST match the document encoder, or cosine is meaningless.
  // This also warms the model. Catches same-dim/different-model and dtype drift up front.
  const probe = await embedder.embedOne(queryPrefix(meta.model) + "ok");
  if (probe.length !== meta.dim) {
    throw new Error(
      `PragmaSearch: query encoder dim ${probe.length} != index dim ${meta.dim} ` +
        `(index built with ${meta.model}/${meta.dtype}). The query and document encoders don't match.`,
    );
  }

  // Searchable fields + weights the index was built with (default if pre-0.3).
  const attrs = resolveSearchable(meta.searchableAttributes);
  // Field the exact-match boost targets: the highest-weight searchable field.
  const primaryField = [...attrs].sort((a, b) => b.weight - a.weight)[0]?.field ?? "title";
  // Tokenizer for the keyword layer (English default; "minimal" or custom for other languages).
  const tok = resolveTokenizer(opts.tokenizer);
  // Query-expansion synonyms for the keyword layer (undefined = disabled, zero cost).
  const synonyms: SynonymExpander | undefined = buildSynonyms(opts.synonyms, tok);
  // Default merchandising rules (a per-query rule set overrides this).
  const defaultRankingRules = opts.rankingRules;

  // Reassigned on incremental add/remove (text changes invalidate the keyword index).
  let keyword = buildKeywordIndex(index.items, attrs, tok);
  let byId = new Map<string, IndexItem>(
    index.items.map((it) => [String(it.id), it]),
  );
  const rebuildDerived = (): void => {
    keyword = buildKeywordIndex(index.items, attrs, tok);
    byId = new Map(index.items.map((it) => [String(it.id), it]));
  };

  // Small LRU cache of query embeddings — autocomplete chips, warm-ups and repeated
  // queries skip the (dominant) model forward pass.
  const QCACHE_MAX = 256;
  const qcache = new Map<string, number[]>();
  async function embedQuery(text: string): Promise<number[]> {
    const cached = qcache.get(text);
    if (cached) {
      qcache.delete(text);
      qcache.set(text, cached); // LRU bump
      return cached;
    }
    const vec = await embedder.embedOne(queryPrefix(meta.model) + text);
    qcache.set(text, vec);
    if (qcache.size > QCACHE_MAX) {
      const oldest = qcache.keys().next().value;
      if (oldest !== undefined) qcache.delete(oldest);
    }
    return vec;
  }

  async function search(
    query: string,
    k = 10,
    opts: SearchOptions = {},
  ): Promise<SearchResponse> {
    const q = query.trim();
    const mode = opts.mode ?? "hybrid";
    const rrfK = opts.rrfK ?? DEFAULT_RRF_K;
    const offset = Math.max(0, Math.floor(opts.offset ?? 0));
    const limit = Math.max(0, k);

    // 1. Narrow to the items passing the filter.
    const candidates = opts.filter
      ? index.items.filter((it) => matchesFilter(it.payload, opts.filter as Filter))
      : index.items;
    const candidateIds = new Set(candidates.map((it) => String(it.id)));

    // 2. Rank the WHOLE filtered set (so pagination + totals are correct).
    let ranked: { id: string; score: number; signals: SearchSignal[] }[];
    // Top cosine of the best semantic match (vector/hybrid only) — a relevance signal.
    let maxScore: number | undefined;

    // The keyword layer ranks the GLOBAL corpus then we filter to candidates. When a
    // filter is active, ask for the full ranking so in-filter matches ranked low
    // globally aren't truncated away before the candidate filter runs.
    const kwLimit = opts.filter ? index.items.length || 1 : candidates.length || 1;

    if (!q) {
      // Browse mode: no query → filtered set in catalog order (lets a UI filter without searching).
      ranked = candidates.map((it) => ({ id: String(it.id), score: 0, signals: [] }));
    } else if (mode === "keyword") {
      ranked = keyword
        .search(q, kwLimit, opts.typo, synonyms)
        .filter((h) => candidateIds.has(h.id))
        .map((h) => ({ id: h.id, score: h.score, signals: ["keyword"] as SearchSignal[] }));
    } else {
      const queryVector = await embedQuery(q);
      const vScored = candidates
        .map((it) => ({ id: String(it.id), score: dot(queryVector, it.vector) }))
        .sort((a, b) => b.score - a.score);
      maxScore = vScored.length ? vScored[0].score : undefined;

      if (mode === "vector") {
        ranked = vScored.map((r) => ({ id: r.id, score: r.score, signals: ["vector"] as SearchSignal[] }));
      } else {
        // hybrid: fuse vector + keyword rankings with RRF, then boost exact title matches.
        const vIds = vScored.map((r) => r.id);
        const kIds = keyword
          .search(q, kwLimit, opts.typo, synonyms)
          .filter((h) => candidateIds.has(h.id))
          .map((h) => h.id);
        const fused = rrfFuse([vIds, kIds], rrfK);
        const exact = exactTitleMatches(q, candidates, primaryField);
        for (const id of exact) fused.set(id, (fused.get(id) ?? 0) + EXACT_BOOST);
        const vSet = new Set(vIds);
        const kSet = new Set(kIds);
        ranked = [...fused.entries()].map(([id, score]) => {
          const signals: SearchSignal[] = [];
          if (vSet.has(id)) signals.push("vector");
          if (kSet.has(id)) signals.push("keyword");
          if (exact.has(id)) signals.push("exact");
          return { id, score, signals };
        });
      }
    }

    ranked.sort((a, b) => b.score - a.score);

    // 2b. Merchandising: boost / bury / pin (post-fusion re-score). Per-query rules
    // override the searcher-level default.
    const rules = opts.rankingRules ?? defaultRankingRules;
    if (rules) {
      ranked = applyRankingRules(ranked, rules, (id) => byId.get(id)?.payload);
    }

    // 3. Paginate + materialize the page.
    const hl = opts.highlight;
    const hlOpts: HighlightOptions | undefined =
      hl && typeof hl === "object" ? hl : undefined;
    const total = ranked.length;
    const hits: SearchResult[] = ranked.slice(offset, offset + limit).map((r) => {
      const item = byId.get(r.id)!;
      const hit: SearchResult = {
        id: item.payload.id,
        score: r.score,
        product: item.payload,
        signals: r.signals,
      };
      if (hl && q) hit.highlights = highlightProduct(item.payload, q, hlOpts, tok);
      return hit;
    });

    // 4. Facet counts over the filtered set (the refinement sidebar).
    const facets =
      opts.facets && opts.facets.length
        ? computeFacets(candidates.map((it) => it.payload), opts.facets, opts.maxFacetValues ?? 20)
        : undefined;

    return { hits, total, offset, limit, facets, maxScore };
  }

  // ---- incremental updates (live catalog sync) ----

  function patch(patches: { id: string | number; fields: Partial<Product> }[]): number {
    // Mutates payloads in place; byId/items share the same refs, and text is unchanged,
    // so the keyword index stays valid — no rebuild.
    return patchPayload(index, patches);
  }

  async function upsert(products: Product[]): Promise<UpsertResult> {
    const { toEmbed, toReuse } = planUpsert(index, products);
    let embedded: IndexItem[] = [];
    if (toEmbed.length) {
      const prefix = docPrefix(meta.model);
      const vectors = await embedder.embed(toEmbed.map((p) => prefix + productText(p, attrs)));
      embedded = toEmbed.map((p, i) => ({
        id: p.id,
        vector: vectors[i].map(round4),
        payload: p,
      }));
    }
    const { added, updated } = applyUpsert(index, embedded, toReuse);
    rebuildDerived(); // text changed for the (re)embedded items
    return { added, updated, reembedded: embedded.length };
  }

  function remove(ids: (string | number)[]): number {
    const removed = removeItems(index, ids);
    if (removed) rebuildDerived();
    return removed;
  }

  return {
    search,
    patchPayload: patch,
    upsert,
    remove,
    index,
    embedder,
    get keyword() {
      return keyword;
    },
  };
}

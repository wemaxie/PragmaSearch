/**
 * PragmaSearch — open-source local-first semantic search.
 *
 * Programmatic API. The typical flow:
 *
 *   import { buildIndex, saveIndex, loadIndex, createSearcher } from "pragmasearch";
 *
 *   // build time (once):
 *   const index = await buildIndex(products);
 *   await saveIndex("pragmasearch-index.json", index);
 *
 *   // query time:
 *   const searcher = await createSearcher(await loadIndex("pragmasearch-index.json"));
 *   const hits = await searcher.search("something for gaming", 10);
 */
export type {
  Product,
  IndexMeta,
  IndexItem,
  PragmaIndex,
  SearchResult,
  SearchMode,
  SearchSignal,
  Filter,
  FilterCondition,
  FacetValue,
  SearchResponse,
  SearchableAttribute,
  ResolvedAttribute,
} from "./types.js";

export { matchesFilter, computeFacets } from "./facets.js";

export {
  resolveSearchable,
  fieldText,
  DEFAULT_SEARCHABLE,
} from "./searchable.js";

export {
  createEmbedder,
  DEFAULT_MODEL,
  DEFAULT_DTYPE,
  type Embedder,
  type EmbedderOptions,
} from "./embedder.js";

export {
  buildIndex,
  productText,
  type BuildIndexOptions,
} from "./index-builder.js";

export {
  searchVectors,
  createSearcher,
  type Searcher,
  type SearcherOptions,
  type SearchOptions,
  type UpsertResult,
} from "./search.js";

export { buildSynonyms, type SynonymOptions } from "./synonyms.js";

export {
  createAnalytics,
  normalizeQuery,
  type Analytics,
  type AnalyticsOptions,
  type AnalyticsState,
  type AnalyticsSummary,
  type SearchEvent,
} from "./analytics.js";

export {
  applyRankingRules,
  type RankingRules,
  type RankingRule,
  type CustomRankingCriterion,
} from "./ranking.js";

export {
  patchPayload,
  removeItems,
  planUpsert,
  applyUpsert,
} from "./incremental.js";

export {
  highlightProduct,
  highlightField,
  type HighlightOptions,
} from "./highlight.js";

export {
  buildKeywordIndex,
  rrfFuse,
  exactTitleMatches,
  tokenize,
  resolveTypo,
  DEFAULT_TYPO,
  type KeywordIndex,
  type KeywordHit,
  type TypoOptions,
  type SynonymExpander,
} from "./hybrid.js";

export { readProducts, saveIndex, loadIndex } from "./storage.js";

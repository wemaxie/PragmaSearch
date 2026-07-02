# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/). This is `0.x` software: the
public API and the on-disk **index format (`INDEX_FORMAT_VERSION = 1`)** may
change between minor versions — pin the version you depend on.

## [Unreleased]

## [0.5.0] - 2026-07-02

### Added
- **Search analytics** — `createAnalytics()` records top queries, **zero-result
  queries**, and latency (p50/p95/p99), bounded in memory and serializable. The
  demo server records every search, serves a gated dashboard at `/analytics` and
  `GET /api/analytics` (+ `POST /api/analytics/reset`), and persists to
  `PRAGMA_ANALYTICS` when set. Query text is gated behind `PRAGMA_ADMIN_TOKEN`.
- **`SearchResponse.maxScore`** — top cosine similarity (0..1) of the best
  semantic match for `vector`/`hybrid` queries. Enables a relevance floor: because
  vector search always returns the nearest items, a low `maxScore` means "no strong
  match". The demo flags zero-result via `PRAGMA_ZERO_FLOOR` (default 0.35).

## [0.4.0] - 2026-07-02

### Added
- **React adapter** (`pragmasearch/react`) — native components (`<PragmaSearch>`,
  `<SearchBox>`, `<RefinementList>`, `<Hits>`, `<Pagination>`, `<ClearRefinements>`,
  `<PoweredBy>`) plus a headless `usePragmaSearch` hook that owns query,
  refinements, pagination, debouncing and fetching. Reuses the `.ps-*` widget
  styles; React is an optional peer dependency (18 or 19). Exposes
  `buildSearchParams` / `searchUrl` / `fetchSearch` for custom clients.

## [0.3.0] - 2026-07-02

### Added
- **Drop-in search widget** (`widget/pragmasearch-widget.js` + `.css`) — a
  dependency-free Algolia-InstantSearch-style UI (search box, autocomplete,
  highlighted hits, faceted sidebar, pagination) that talks to `/api/search`.
  Themeable via `--ps-*` CSS vars; served by the demo server at `/widget`.
- Read API now sends CORS (`PRAGMA_CORS_ORIGIN`, default `*`) so the widget can
  run cross-origin.
- **Configurable searchable attributes & field weights** — choose which fields
  are searched and how heavily (`--searchable "title^3,brand^2,description"` /
  `buildIndex(products, { searchableAttributes })`). Replaces the hardcoded
  field list and title×2 weight; the config is stored in the index `meta` so
  search and `upsert` reuse it. Default is unchanged
  (`title^2, description, category, tags`) — existing indexes keep working.
  Exposes `resolveSearchable` / `fieldText` / `DEFAULT_SEARCHABLE`.
- **Synonyms** — query expansion for the keyword layer, multi-way `groups` and
  directional `oneWay`, with a configurable synonym `weight`. Pass via
  `createSearcher(index, { synonyms })`, the CLI `--synonyms <file.json>`, or the
  demo server's `PRAGMA_SYNONYMS`. Exposes `buildSynonyms`.
- **Ranking rules / merchandising** — `boost` / `bury` items by filter or id, and
  `pin` ids to the top, applied as a post-fusion re-score (works in every mode).
  Set on the searcher (`createSearcher(index, { rankingRules })`) or per query
  (`search(q, k, { rankingRules })`); CLI `--rules <file.json>`; demo
  `PRAGMA_RANKING`. Pinned hits carry a `"pinned"` signal. Exposes
  `applyRankingRules`.

## [0.2.0]

### Added
- **Incremental indexing** for live catalogs: `patchPayload` (price/stock without
  re-embedding, no model), `Searcher.upsert` (embeds only new/text-changed products),
  `Searcher.remove`. Token-gated HTTP write endpoints `POST /api/patch|upsert|remove`
  (`PRAGMA_ADMIN_TOKEN`).
- **Result highlighting** — `highlight` search option / `&highlight=on` returns per-field
  HTML with query matches wrapped in `<mark>` (stem-aware, HTML-safe). `highlightProduct`/`highlightField` exported.

## [0.1.0]

### Added
- Hybrid search: own zero-dependency BM25 keyword layer fused with brute-force
  cosine vector search via Reciprocal Rank Fusion, plus an exact-title boost.
- Filtering, faceting (value→count) and pagination in `search()` / the API.
- Configurable typo tolerance (length-scaled edit distance, e.g. `opple` → `apple`).
- Multilingual support via `--model Xenova/multilingual-e5-small` (query/passage
  prefixes applied automatically per model).
- CLI (`index` / `search`), programmatic API, and a demo server with instant
  in-browser autocomplete and a faceted refinement sidebar.
- Unit test suite (`npm test`), CI, and docs (configuration + performance/VPS sizing).

### Security
- Demo server: input length clamp, per-IP rate limiting, restrictive CSP, no
  internal error leakage, gzip responses. Browser UI: `http(s)`-only URL
  allowlist and full HTML escaping of product fields.

### Notes
- Validates encoder match (model/dtype/format version) when loading an index to
  prevent silently querying with a different encoder than the documents.

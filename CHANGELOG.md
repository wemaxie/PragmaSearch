# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/). This is `0.x` software: the
public API and the on-disk **index format (`INDEX_FORMAT_VERSION = 1`)** may
change between minor versions — pin the version you depend on.

## [Unreleased]

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

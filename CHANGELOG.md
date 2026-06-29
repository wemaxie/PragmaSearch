# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/). This is `0.x` software: the
public API and the on-disk **index format (`INDEX_FORMAT_VERSION = 1`)** may
change between minor versions — pin the version you depend on.

## [Unreleased]

### Added
- Hybrid search: own zero-dependency BM25 keyword layer fused with brute-force
  cosine vector search via Reciprocal Rank Fusion, plus an exact-title boost.
- Configurable typo tolerance (length-scaled edit distance, e.g. `opple` → `apple`).
- Multilingual support via `--model Xenova/multilingual-e5-small` (query/passage
  prefixes applied automatically per model).
- CLI (`index` / `search`), programmatic API, and a local demo server with an
  instant in-browser autocomplete.
- Unit test suite (`npm test`) and CI.

### Security
- Demo server: input length clamp, per-IP rate limiting, restrictive CSP, no
  internal error leakage, gzip responses. Browser UI: `http(s)`-only URL
  allowlist and full HTML escaping of product fields.

### Notes
- Validates encoder match (model/dtype/format version) when loading an index to
  prevent silently querying with a different encoder than the documents.

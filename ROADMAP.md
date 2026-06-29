# Roadmap

PragmaSearch today is a working single-machine retrieval engine: hybrid BM25 +
vector search with RRF fusion, an exact-title boost, configurable typo tolerance,
multilingual support, a CLI, a programmatic API, and a local demo server. It is
**not yet a full search platform** — it returns a flat top-K of results.

Honest positioning: it sits next to **Orama** (embeddable hybrid search) and
**Pagefind** (static/client-side index), not Algolia/Meilisearch/Typesense (full
platforms). The thing PragmaSearch does that the others don't out of the box:
**drop-in meaning-based hybrid search with the model included, zero cloud, zero
API keys, $0** — best for small-to-mid catalogs (≤ ~50k items).

## Toward a real product (prioritized)

**v1 (table stakes a catalog adopter hits on day one)**
- [ ] Filtering & faceting (price / category / brand) with facet counts
- [ ] Pagination / offset
- [ ] Result highlighting & snippets
- [ ] Incremental index updates (add / update / delete without a full re-embed)
- [ ] Fully client-side browser build (model in-browser via WASM/WebGPU, IndexedDB cache)
- [ ] Client SDK + framework adapters (React / Next / Vue / Astro) and a drop-in search widget
- [ ] A quickstart that runs end-to-end on a clean machine

**Should-have (relevance tuning + production readiness)**
- [ ] Configurable searchable attributes & field weights
- [ ] Synonyms and custom ranking rules (boost / bury / pin)
- [ ] Persist the keyword index instead of rebuilding on cold start
- [ ] Server-mode API auth + CORS config (rate limiting already present)
- [ ] Language-aware tokenization (stemmer/stopwords per language)
- [ ] Compact / quantized index format (gzip + int8 vectors) — prerequisite for the browser build

**Nice-to-have**
- [ ] Search analytics (top queries, zero-result queries, latency) and a docs site
- [ ] Reproducible public relevance benchmark

Have a use case or a must-have we're missing? Open an issue.

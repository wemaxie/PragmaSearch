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

**v1 — "Search-UX": the table stakes a catalog adopter hits on day one**
- [x] Filtering & faceting (price / category / brand) with facet counts
- [x] Pagination / offset
- [x] Result highlighting (stem-aware `<mark>`; snippet windows still TODO)
- [x] Drop-in search widget (dependency-free, themeable, faceted) — [docs](docs/widget.md)
- [x] React adapter — native components + a headless `usePragmaSearch` hook, published as `pragmasearch/react` ([docs](docs/react.md)). Vue adapter still TODO.
- [x] Incremental index updates (add / update / delete without a full re-embed)

**Should-have (relevance tuning + production readiness)**
- [x] Configurable searchable attributes & field weights ([docs](docs/configuration.md#searchable-attributes--field-weights))
- [x] Synonyms — multi-way + one-way query expansion ([docs](docs/configuration.md#synonyms))
- [x] Custom ranking rules / merchandising — boost / bury / pin + custom-ranking tie-break chain ([docs](docs/configuration.md#ranking-rules--merchandising))
- [ ] Persist the keyword index instead of rebuilding on cold start
- [x] Signed multi-tenant search tokens — HMAC-signed forced filters ([docs](docs/configuration.md#multi-tenant-search-tokens))
- [ ] Server-mode API auth + CORS config (rate limiting + write-token + search-token already present)
- [ ] Language-aware tokenization (stemmer/stopwords per language)
- [x] Compact / quantized index format (gzip + int8 vectors) — CLI `--compact` / `saveIndex({compact})`, ~8× smaller, same ranking

**Nice-to-have**
- [x] Search analytics — top queries, **zero-result queries**, latency ([docs](docs/configuration.md#analytics)). Next: A/B testing, a docs site
- [ ] `SearchResponse.maxScore` relevance floor to return honest zero-results in the UI (signal shipped; UI opt-in TODO)
- [ ] Reproducible public relevance benchmark

**Not planned**
- A fully client-side, in-browser build (model shipped to the browser). The first-load
  weight makes it a poor fit for the self-hosted server model PragmaSearch targets.

Have a use case or a must-have we're missing? Open an issue.

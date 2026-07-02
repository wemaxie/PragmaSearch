# Configuration reference

Everything you can configure in PragmaSearch: indexing, search, filtering, faceting,
the server, and the programmatic API.

## Indexing

Build an index once from your products JSON. Each product needs at least `{ id, title }`;
everything else is carried through as payload and is filterable/facetable.

```bash
npx pragmasearch index products.json [--out <file>] [--model <id>] [--dtype <q8|fp32>] [--searchable <fields>]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--out` | `pragmasearch-index.json` | Where to write the index file |
| `--model` | `Xenova/all-MiniLM-L6-v2` | Embedding model (see [Models](#models)) |
| `--dtype` | `q8` | Quantization: `q8` (small/fast) or `fp32` (max quality) |
| `--searchable` | `title^2,description,category,tags` | Fields to search + weights (see [below](#searchable-attributes--field-weights)) |
| `--compact` | off | Write a compact index: int8-quantized vectors + gzip (~8× smaller, ~0.4% quantization error, same ranking). `loadIndex` reads it transparently. |

Programmatic equivalent:

```ts
import { buildIndex, saveIndex } from "pragmasearch";
const index = await buildIndex(products, { model, dtype, batchSize: 64 });
await saveIndex("pragmasearch-index.json", index);
```

The index records the model/dtype/dim/format-version in its `meta`, so the query encoder
always matches the document encoder — querying with a mismatched encoder throws instead of
returning garbage.

### Searchable attributes & field weights

By default PragmaSearch searches `title` (weighted ×2), `description`, `category` and `tags`.
Override this to index other fields (e.g. `brand`, `sku`) or to change how much each one
counts toward relevance:

```bash
npx pragmasearch index products.json --searchable "title^3,brand^2,description,tags"
```

```ts
await buildIndex(products, {
  searchableAttributes: ["title^3", "brand^2", "description", { field: "sku", weight: 1 }],
});
```

- Syntax: `"field"` (weight 1) or `"field^N"`; programmatically also `{ field, weight }`.
- **Weight** scales the field's contribution to the keyword (BM25) layer — a term in a
  weight-2 field counts as if it appeared twice. The exact-match boost targets the
  **highest-weight** field (so keep your display/title field first or heaviest).
- Fields not listed are **not searched** (but stay filterable/facetable and are returned in
  the payload). Values can be strings, string arrays (like `tags`), or numbers.
- The config is stored in the index `meta`, so search and incremental `upsert` reuse the
  exact same fields/weights. Changing it requires re-indexing.

> Note on the vector layer: a product is embedded as one mean-pooled vector, so weights
> tune the keyword layer, not the vector. The listed fields (in order) make up the embedded
> text; the leading field carries the most semantic signal for these short sentence models.

## Searching

```bash
npx pragmasearch search "your query" [--index <file>] [-k <n>] [--mode <hybrid|vector|keyword>] [--typo <on|off>]
```

Programmatic — `search(query, k, options)` returns a `SearchResponse`:

```ts
const searcher = await createSearcher(await loadIndex("pragmasearch-index.json"));
const { hits, total, offset, limit, facets } = await searcher.search("for gaming", 12, {
  mode: "hybrid",
  typo: true,
  filter: { category: "Graphics Cards", price: { lte: 1000 } },
  facets: ["category", "brand"],
  offset: 0,
});
```

### Search options

| Option | Default | Description |
|--------|---------|-------------|
| `mode` | `"hybrid"` | `hybrid` (vector + keyword + exact boost), `vector` (meaning only), `keyword` (BM25 only) |
| `typo` | `true` | Typo tolerance — `true` / `false`, or `{ minLength, secondTypoLength, penalty }` |
| `filter` | — | Restrict results (see [Filtering](#filtering)) |
| `facets` | — | Array of fields to count, e.g. `["category", "brand"]` |
| `maxFacetValues` | `20` | Max values returned per facet |
| `offset` | `0` | Pagination offset; `k` is the page size |
| `rrfK` | `60` | Reciprocal Rank Fusion constant (advanced) |

### Response shape

```ts
interface SearchResponse {
  hits: SearchResult[];                       // { id, score, product, signals }
  total: number;                              // matches after filtering, before pagination
  offset: number;
  limit: number;
  facets?: Record<string, { value: string; count: number }[]>;
  maxScore?: number;                          // top cosine similarity (vector/hybrid); see Analytics
}
```

`signals` on each hit shows *why* it matched: `["vector"]`, `["keyword"]`, `["exact"]`, `["pinned"]`, or a combination.

Highlighting: pass `highlight: true` (or `{ fields, pre, post }`) to get `<mark>`-wrapped,
HTML-safe matches per field. For long descriptions, `highlight: { snippet: 20 }` (HTTP:
`&snippet=20`) returns a ~20-word windowed excerpt around the first match with `…` ellipsis
(Algolia's `_snippetResult`). `snippetField` / `highlightField` are exported.

`maxScore` is the best semantic match's cosine similarity (0..1) for `vector`/`hybrid` queries.
Because vector search always returns the *nearest* items, a low `maxScore` (e.g. < ~0.35 for
MiniLM) means "nothing really matched" even though `total` is non-zero — use it for a relevance
floor or zero-result detection (see [Analytics](#analytics)).

## Filtering

A filter is an object; conditions are **AND**ed across fields.

```ts
{ category: "Laptops" }                       // exact match
{ brand: ["Apple", "Dell"] }                  // OR within a field
{ price: { gte: 500, lte: 1500 } }            // numeric range
{ tags: "gaming" }                            // membership in an array field
{ category: "Monitors", price: { lte: 600 } } // combined (AND)
```

Over the HTTP API, pass it URL-encoded: `&filter={"category":"Laptops"}`.

## Faceting

Request `facets: ["category", "brand", ...]` to get value→count buckets over the
filtered set — exactly what a refinement sidebar renders. Counts handle array fields
(e.g. `tags`). In v1, facet counts reflect the active **filters**; the text query
re-ranks within them.

## Typo tolerance

```ts
typo: { minLength: 4, secondTypoLength: 8, penalty: 0.5 }
```

| Field | Default | Meaning |
|-------|---------|---------|
| `minLength` | 4 | Words ≥ this length may absorb 1 typo |
| `secondTypoLength` | 8 | Words ≥ this length may absorb 2 typos |
| `penalty` | 0.5 | Score multiplier per edit-distance unit (so exact hits rank first) |

## Synonyms

Synonyms widen the **keyword** layer so literal terms your catalog doesn't use still
match. They're applied as query expansion — a synonym match scores a bit lower than a
genuine one (default `weight` 0.6), so real matches still rank first.

```ts
const searcher = await createSearcher(index, {
  synonyms: {
    groups: [                                   // multi-way: any member matches all
      ["laptop", "notebook"],
      ["earphones", "headphones", "earbuds"],
    ],
    oneWay: [                                   // directional: from → to only
      { from: "iphone", to: ["apple phone"] },
    ],
    weight: 0.6,
  },
});
```

- **`groups`** — equivalence sets; querying any member also matches the others.
- **`oneWay`** — querying `from` also matches `to`, but not the reverse (e.g. a brand
  → its generic term).
- Phrases are tokenized/stemmed like documents, so `"laptops"` and `"laptop"` unify, and
  multi-word phrases (`"graphics card"`) are matched as a contiguous run in the query.

CLI: `pragmasearch search "earphones" --synonyms synonyms.json` (the JSON is the object
above). Demo server: point `PRAGMA_SYNONYMS` at that file.

## Ranking rules / merchandising

Merchandising on top of relevance — applied as a post-fusion re-score, so it works in
every mode (hybrid, vector, keyword, and browse):

```ts
const searcher = await createSearcher(index, {
  rankingRules: {
    boost: [{ filter: { brand: "Acme" }, by: 0.5 }],   // nudge a brand up
    bury:  [{ filter: { inStock: false }, by: 1 }],     // push out-of-stock down
    customRanking: ["desc(sales)", "desc(rating)"],     // best-sellers first, all else equal
    pin:   ["SKU-HERO", "SKU-2"],                        // force to the top, in order
  },
});
```

- **`pin`** — force these ids to the very top, in order, regardless of score (they're
  tagged with a `"pinned"` signal). The hard promotion for a hero product or a category page.
- **`boost` / `bury`** — raise/lower items matching a `filter` and/or an `ids` list. The
  amount `by` is expressed in units of the **top result's score**, so the same value behaves
  consistently across modes (`by: 1` ≈ one top-result's worth; `0.2` is a gentle nudge).
- **`customRanking`** — a tie-break chain applied *within* relevance tiers: among results of
  similar relevance, order by business fields. Each criterion is `"desc(field)"` / `"asc(field)"`
  (or a bare `"field"` = descending, or `{ field, order }`); missing values sort last. "Similar
  relevance" means scores within `customRankingEpsilon` of each other (default `0.05` = 5% of the
  top score) — so genuine relevance still wins, and `customRanking` only decides near-ties.

Order of application: `boost`/`bury` re-score, then `customRanking` tie-breaks, then `pin`.

Rules can be set once on the searcher (above) or **per query** via
`search(q, k, { rankingRules })`, which overrides the searcher default — handy for
query-conditional merchandising (e.g. pin a promo for one search term).

CLI: `pragmasearch search "keyboard" --rules rules.json`. Demo server: `PRAGMA_RANKING`.

## Analytics

The demo server records every search and exposes **what people search, what returns
nothing, and how fast** — the zero-result list is the most direct signal of which synonyms,
ranking rules or catalog gaps to fix.

- **Dashboard:** `GET /analytics` (an HTML page; paste your admin token to load data).
- **API:** `GET /api/analytics?topN=50` → a JSON summary (`totalSearches`, `zeroResultRate`,
  `topQueries`, `zeroResultQueries`, `latency` p50/p95/p99, …). `POST /api/analytics/reset` clears it.
- **Gating:** both require `Authorization: Bearer <PRAGMA_ADMIN_TOKEN>` — query text is your data,
  so it's never exposed publicly (the endpoints are disabled unless the admin token is set).
- **Persistence:** set `PRAGMA_ANALYTICS` to a file path to load on start + save periodically;
  otherwise analytics live in memory for the process lifetime.

Zero-result for semantic search: because `vector`/`hybrid` always return the nearest items, a
query counts as zero-result when the top similarity is below `PRAGMA_ZERO_FLOOR` (default `0.35`,
tuned for MiniLM/e5 — raise it for pickier models), or when a filter excludes everything.

Programmatic (`createAnalytics` is exported, dependency-free) if you run your own server:

```ts
import { createAnalytics } from "pragmasearch";
const analytics = createAnalytics();
analytics.record({ query: "flying carpet", results: resp.total, zero: (resp.maxScore ?? 1) < 0.35, ms });
analytics.summary({ topN: 20 }); // { zeroResultQueries, topQueries, latency, ... }
```

## Multi-tenant search tokens

For per-user or per-tenant scoping, mint an HMAC-signed token that carries a **forced
filter** the browser can't tamper with — it can only narrow *within* the scope, never
widen or drop it (the analog of Meilisearch tenant tokens / Typesense scoped keys).

```bash
# server: set PRAGMA_SEARCH_SECRET, then mint a token per tenant
npx pragmasearch token --secret "$SECRET" --filter '{"tenant":"acme"}' --exp 3600
# → eyJmaWx0ZXIi….<sig>   (send with each search: /api/search?...&token=<token>)
```

```ts
import { signSearchToken, verifySearchToken, mergeForcedFilter } from "pragmasearch";
const token = signSearchToken({ filter: { tenant: "acme" }, exp: 1893456000 }, secret);
const { filter } = verifySearchToken(token, secret);          // throws if tampered/expired
const effective = mergeForcedFilter(clientFilter, filter);    // forced fields win
```

On the demo server, set `PRAGMA_SEARCH_SECRET` to enable `&token=`; the token's filter is
AND-ed into the query and a bad/expired token returns `401`. The payload is signed, not
encrypted — don't put secrets in the filter. `exp` is a Unix time in **seconds** (optional).

## Production server

`demo/server.ts` is a reference with a bundled demo UI. For production, run the hardened,
dependency-free **JSON API server** that ships in the package — it has the same security
posture (input clamp, per-IP rate limiting, restrictive headers, gzip, no error leakage) and
serves `/api/search` + `/api/meta`, token-gated writes, and (optional) analytics. Put a UI in
front of it with the [widget](widget.md) or the [React](react.md)/[Vue](vue.md) adapters.

```bash
PRAGMA_ADMIN_TOKEN=… PRAGMA_SEARCH_SECRET=… npx pragmasearch serve pragmasearch-index.json --port 8080
```

Or embed it:

```ts
import { loadIndex, createSearcher, createSearchServer, createAnalytics } from "pragmasearch";

const searcher = await createSearcher(await loadIndex("pragmasearch-index.json"));
createSearchServer(searcher, {
  corsOrigin: "https://myshop.com",
  adminToken: process.env.ADMIN_TOKEN,     // enables POST /api/patch|upsert|remove + analytics
  searchSecret: process.env.SEARCH_SECRET, // enables signed &token= forced filters
  analytics: createAnalytics(),            // enables GET /api/analytics
  rateLimit: 60,                            // per IP / 10s (0 disables)
  trustProxy: true,                         // ONLY if behind a proxy that overwrites X-Forwarded-For
}).listen(8080);
```

Rate limiting keys on the socket address by default. Set `trustProxy: true` (or the
`TRUST_PROXY=1` env var for `serve` / the demo) **only** when you run behind a reverse proxy
that overwrites `X-Forwarded-For` (Railway, Render, nginx) — otherwise the header is
client-controlled and would let each spoofed value dodge the limit.

Both `serve` and `createSearchServer` read the same env vars below (`PORT`,
`PRAGMA_ADMIN_TOKEN`, `PRAGMA_SEARCH_SECRET`, `PRAGMA_CORS_ORIGIN`, `PRAGMA_ANALYTICS`).

## Demo server environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5173` | Port to listen on (hosts like Railway/Render set this) |
| `PRAGMA_INDEX` | `pragmasearch-index.json` | Index file to serve (or pass as the first CLI arg) |
| `PRAGMA_PRODUCTS` | `data/products.json` | Products to build from if the index is missing |
| `PRAGMA_CHIPS` | sample queries | Pipe-separated example queries shown as chips |
| `PRAGMA_SYNONYMS` | — | Path to a synonyms JSON file (see [Synonyms](#synonyms)) |
| `PRAGMA_RANKING` | — | Path to a ranking-rules JSON file (see [Ranking rules](#ranking-rules--merchandising)) |
| `PRAGMA_TOKENIZER` | `english` | Keyword tokenizer preset (`english` / `minimal`); see [Non-English catalogs](#non-english-catalogs-tokenizer) |
| `PRAGMA_ANALYTICS` | — | Path to persist search analytics (see [Analytics](#analytics)); in-memory only if unset |
| `PRAGMA_ZERO_FLOOR` | `0.35` | Top-similarity threshold below which a semantic query counts as zero-result |
| `PRAGMA_MODEL_CACHE` | — | Directory to cache/bake model weights (used by the Dockerfile) |
| `PRAGMA_ADMIN_TOKEN` | — | Bearer token that enables the live write endpoints (see below). Unset = writes disabled. |
| `PRAGMA_SEARCH_SECRET` | — | Secret for signed [search tokens](#multi-tenant-search-tokens); enables `&token=` on `/api/search` |
| `PRAGMA_CORS_ORIGIN` | `*` | `Access-Control-Allow-Origin` for the read API (set to your storefront origin) |

## Incremental updates (live catalogs)

Re-embedding the whole catalog on every change is wasteful. The expensive part is the
embedding pass — but **fields that don't change the searchable text (price, stock,
availability) don't need it.** PragmaSearch separates the two:

**Programmatic** (e.g. from a cron — `patchPayload` needs no model):

```ts
import { loadIndex, saveIndex, patchPayload, createSearcher } from "pragmasearch";

// price/stock churn — patch the payload, NO re-embedding, no model:
const index = await loadIndex("pragmasearch-index.json");
patchPayload(index, [{ id: "SKU1", fields: { price: 1299, stock: 4 } }]);
await saveIndex("pragmasearch-index.json", index);

// new / renamed products — only the delta is embedded:
const searcher = await createSearcher(index);
await searcher.upsert([{ id: "SKU2", title: "New product", price: 99 }]); // returns { added, updated, reembedded }
searcher.remove(["SKU3"]);
await saveIndex("pragmasearch-index.json", searcher.index);
```

`upsert` re-embeds a product only if its searchable text changed; otherwise it keeps the
existing vector and just swaps the payload. `patchPayload` never touches the model.

**Over HTTP** (point your stock/price crons and publish-queue at the running server; set
`PRAGMA_ADMIN_TOKEN` to enable, send it as `Authorization: Bearer <token>`):

```bash
# price/stock — no model, instant:
curl -X POST $URL/api/patch  -H "Authorization: Bearer $TOKEN" \
  -d '{"patches":[{"id":"SKU1","fields":{"price":1299,"stock":4}}]}'

# add / update products (embeds only the delta):
curl -X POST $URL/api/upsert -H "Authorization: Bearer $TOKEN" \
  -d '{"products":[{"id":"SKU2","title":"New product","price":99}]}'

curl -X POST $URL/api/remove -H "Authorization: Bearer $TOKEN" -d '{"ids":["SKU3"]}'
```

Each write persists the index to disk and refreshes the autocomplete list. For very high
write rates, batch updates or save periodically rather than per request.

The server validates and clamps input, rate-limits `/api/search`, sends a restrictive CSP,
and gzips responses. See [DEPLOY.md](../DEPLOY.md) and [performance](performance.md).

## Models

The model is recorded in the index; pick it at index time with `--model`.

| Model | Languages | Dim | Size (q8) | Speed | Use for |
|-------|-----------|-----|-----------|-------|---------|
| `Xenova/all-MiniLM-L6-v2` *(default)* | English | 384 | ~23 MB | fastest | English catalogs |
| `Xenova/bge-small-en-v1.5` | English | 384 | ~33 MB | fast | English, slightly higher recall |
| `Xenova/multilingual-e5-small` | 100+ | 384 | ~110 MB | ~3–5× slower | non-English / mixed |

Query/passage prefixes (needed by e5 and bge) are applied automatically based on the model.
All three are 384-dim, so switching models only requires re-indexing — the store layout is unchanged.

### Non-English catalogs (tokenizer)

The vector layer is multilingual (via the e5 model), but the **keyword (BM25) layer** has a
tokenizer with English stopwords + a light plural stemmer. Words of any script survive
tokenization (Unicode-aware split), but the English stemmer/stopwords are wrong for other
languages. For a non-English catalog, use the `minimal` tokenizer (Unicode split only, no
stopwords/stemming) — or plug your own:

```ts
// preset, options, or a function — applies to BM25, queries, synonyms and highlighting
createSearcher(index, { tokenizer: "minimal" });
createSearcher(index, { tokenizer: { stopwords: ["der", "die", "das"], stem: myGermanStemmer } });
```

CLI: `pragmasearch search "…" --tokenizer minimal`. Demo server: `PRAGMA_TOKENIZER=minimal`.

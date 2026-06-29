# Configuration reference

Everything you can configure in PragmaSearch: indexing, search, filtering, faceting,
the server, and the programmatic API.

## Indexing

Build an index once from your products JSON. Each product needs at least `{ id, title }`;
everything else is carried through as payload and is filterable/facetable.

```bash
npx pragmasearch index products.json [--out <file>] [--model <id>] [--dtype <q8|fp32>]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--out` | `pragmasearch-index.json` | Where to write the index file |
| `--model` | `Xenova/all-MiniLM-L6-v2` | Embedding model (see [Models](#models)) |
| `--dtype` | `q8` | Quantization: `q8` (small/fast) or `fp32` (max quality) |

Programmatic equivalent:

```ts
import { buildIndex, saveIndex } from "pragmasearch";
const index = await buildIndex(products, { model, dtype, batchSize: 64 });
await saveIndex("pragmasearch-index.json", index);
```

The index records the model/dtype/dim/format-version in its `meta`, so the query encoder
always matches the document encoder — querying with a mismatched encoder throws instead of
returning garbage.

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
}
```

`signals` on each hit shows *why* it matched: `["vector"]`, `["keyword"]`, `["exact"]`, or a combination.

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

## Demo server environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5173` | Port to listen on (hosts like Railway/Render set this) |
| `PRAGMA_INDEX` | `pragmasearch-index.json` | Index file to serve (or pass as the first CLI arg) |
| `PRAGMA_PRODUCTS` | `data/products.json` | Products to build from if the index is missing |
| `PRAGMA_CHIPS` | sample queries | Pipe-separated example queries shown as chips |
| `PRAGMA_MODEL_CACHE` | — | Directory to cache/bake model weights (used by the Dockerfile) |

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

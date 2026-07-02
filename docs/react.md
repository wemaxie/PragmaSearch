# React adapter

Native React components and a headless hook for PragmaSearch, published as a
subpath of the package: `pragmasearch/react`. They talk to a running PragmaSearch
server's `/api/search` (same contract as the [drop-in widget](widget.md)) and emit
the same `.ps-*` classes, so the widget stylesheet themes them too.

React is a **peer dependency** (React 18 or 19) — you already have it in your app;
nothing extra to install beyond `pragmasearch`.

## Components

```tsx
import {
  PragmaSearch, SearchBox, RefinementList, Hits, Pagination, ClearRefinements,
} from "pragmasearch/react";
import "pragmasearch/widget/pragmasearch-widget.css"; // optional theme (reuses --ps-* vars)

export function Search() {
  return (
    <PragmaSearch endpoint="https://search.myshop.com" facets={["category", "brand"]}>
      <SearchBox placeholder="Search products…" />
      <div className="ps-layout">
        <aside className="ps-facets">
          <RefinementList attribute="category" />
          <RefinementList attribute="brand" />
          <ClearRefinements />
        </aside>
        <div>
          <Hits />
          <Pagination />
        </div>
      </div>
    </PragmaSearch>
  );
}
```

Custom hit markup:

```tsx
<Hits renderHit={(hit) => (
  <a href={`/p/${hit.id}`} className="ps-body">
    <div className="ps-title">{hit.product.title as string}</div>
    <span className="ps-price">${hit.product.price as number}</span>
  </a>
)} />
```

`<PragmaSearch>` renders a `.ps-root` wrapper and provides context; the other
components must be rendered inside it. Components: `SearchBox`, `RefinementList`
(`attribute`, optional `title`), `Hits` (`renderHit`, `emptyText`), `Pagination`,
`ClearRefinements`, `PoweredBy`.

## Headless hook

For a fully custom UI, use `usePragmaSearch` directly — it owns query, refinements,
pagination, debouncing and fetching (aborting stale requests):

```tsx
import { usePragmaSearch } from "pragmasearch/react";

function Search() {
  const s = usePragmaSearch({ endpoint: "https://search.myshop.com", facets: ["category"] });
  return (
    <>
      <input value={s.query} onChange={(e) => s.setQuery(e.target.value)} />
      {s.loading && <span>…</span>}
      <ul>{s.results.map((h) => <li key={String(h.id)}>{h.product.title as string}</li>)}</ul>
      <button disabled={s.page === 0} onClick={() => s.setPage(s.page - 1)}>Prev</button>
      <span>{s.total} results</span>
    </>
  );
}
```

## Options

`usePragmaSearch(options)` and `<PragmaSearch {...options}>` take the same options:

| Option | Default | Description |
|--------|---------|-------------|
| `endpoint` | `""` | PragmaSearch server base URL (`""` = same origin) |
| `hitsPerPage` | `12` | Page size |
| `facets` | — | Fields to request for `<RefinementList>` |
| `mode` | `"hybrid"` | `hybrid` / `vector` / `keyword` |
| `typo` | `true` | Typo tolerance |
| `highlight` | `true` | Request `<mark>`-highlighted fields |
| `initialQuery` | `""` | Starting query |
| `debounceMs` | `180` | Debounce for query/refinement changes |

The hook returns `{ query, setQuery, results, total, facets, refinements,
toggleRefinement, clearRefinements, isRefined, page, setPage, pageCount,
hitsPerPage, loading, error, ms }`.

## Next.js

The components use client state, so render them in a Client Component:

```tsx
"use client";
import { PragmaSearch, SearchBox, Hits } from "pragmasearch/react";
export default function Search() {
  return <PragmaSearch endpoint={process.env.NEXT_PUBLIC_SEARCH_URL}><SearchBox /><Hits /></PragmaSearch>;
}
```

## Theming & CORS

Same as the widget: override the `--ps-*` CSS variables (see
[widget docs](widget.md#theming)), and make sure your search server allows the
storefront origin (`PRAGMA_CORS_ORIGIN`) since the browser calls `/api/search`
cross-origin.

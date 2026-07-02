# Vue adapter

Vue 3 components and a composable for PragmaSearch, published as `pragmasearch/vue`.
They talk to a running PragmaSearch server's `/api/search` (same contract as the
[widget](widget.md) and [React adapter](react.md)) and emit the same `.ps-*`
classes, so the widget stylesheet themes them.

Vue is an optional **peer dependency** (Vue 3.3+). The components are built with
render functions — no SFC compiler or plugin needed.

## Components

```vue
<script setup>
import {
  PragmaSearch, SearchBox, RefinementList, Hits, Pagination, ClearRefinements,
} from "pragmasearch/vue";
import "pragmasearch/widget/pragmasearch-widget.css"; // optional theme
</script>

<template>
  <PragmaSearch endpoint="https://search.myshop.com" :facets="['category', 'brand']">
    <SearchBox placeholder="Search products…" />
    <div class="ps-layout">
      <aside class="ps-facets">
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
</template>
```

Custom hit markup via the `hit` scoped slot:

```vue
<Hits>
  <template #hit="{ hit }">
    <a :href="`/p/${hit.id}`" class="ps-body">
      <div class="ps-title">{{ hit.product.title }}</div>
      <span class="ps-price">${{ hit.product.price }}</span>
    </a>
  </template>
</Hits>
```

`<PragmaSearch>` provides the search state via `provide`/`inject`; the other
components must be descendants. Components: `SearchBox`, `RefinementList`
(`attribute`, optional `title`), `Hits` (`emptyText`, `#hit` slot), `Pagination`,
`ClearRefinements`, `PoweredBy`.

## Headless composable

```vue
<script setup>
import { usePragmaSearch } from "pragmasearch/vue";
const s = usePragmaSearch({ endpoint: "https://search.myshop.com", facets: ["category"] });
// s.query (ref), s.setQuery, s.results, s.total, s.facets, s.refinements,
// s.toggleRefinement, s.clearRefinements, s.page, s.setPage, s.loading, s.error
</script>

<template>
  <input :value="s.query.value" @input="s.setQuery($event.target.value)" />
  <span v-if="s.loading.value">…</span>
  <ul><li v-for="h in s.results.value" :key="String(h.id)">{{ h.product.title }}</li></ul>
</template>
```

## Options

`usePragmaSearch(options)` / `<PragmaSearch v-bind="options">` take the same options
as the [React adapter](react.md#options): `endpoint`, `hitsPerPage`, `facets`,
`mode`, `typo`, `highlight`, `initialQuery`, `debounceMs`.

## Theming & CORS

Same as the widget — override the `--ps-*` CSS variables (see
[widget docs](widget.md#theming)), and allow your storefront origin on the search
server (`PRAGMA_CORS_ORIGIN`).

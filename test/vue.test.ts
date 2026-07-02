/**
 * Smoke tests for the Vue adapter — SSR-render (no jsdom) + a composable check via
 * effectScope. Uses an empty initial query so no fetch is scheduled during render.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSSRApp, h, effectScope } from "vue";
import { renderToString } from "vue/server-renderer";

import {
  PragmaSearch,
  SearchBox,
  RefinementList,
  Hits,
  Pagination,
  usePragmaSearch,
  type PragmaSearchState,
} from "../src/vue.js";

test("Vue: <PragmaSearch> renders the .ps-* scaffold and stays inert before a fetch", async () => {
  const app = createSSRApp({
    render: () =>
      h(PragmaSearch, { endpoint: "http://localhost:5173", facets: ["category"] }, {
        default: () => [
          h(SearchBox, { placeholder: "Find products" }),
          h(RefinementList, { attribute: "category" }),
          h(Hits),
          h(Pagination),
        ],
      }),
  });
  const html = await renderToString(app);
  assert.match(html, /class="ps-root"/);
  assert.match(html, /class="ps-searchbar"/);
  assert.match(html, /placeholder="Find products"/);
  assert.match(html, /class="ps-empty"/);
  assert.doesNotMatch(html, /class="ps-hit"/);
  assert.doesNotMatch(html, /class="ps-fgroup"/);
});

test("Vue: components error when used outside <PragmaSearch>", async () => {
  const app = createSSRApp({ render: () => h(SearchBox) });
  await assert.rejects(() => renderToString(app), /inside <PragmaSearch>/);
});

test("Vue: usePragmaSearch composable exposes reactive state; setQuery resets the page", () => {
  const scope = effectScope();
  let s!: PragmaSearchState;
  scope.run(() => {
    s = usePragmaSearch({ endpoint: "" });
  });
  assert.equal(s.query.value, "");
  assert.equal(s.page.value, 0);
  s.setPage(2);
  assert.equal(s.page.value, 2);
  s.setQuery("hi");
  assert.equal(s.query.value, "hi");
  assert.equal(s.page.value, 0); // query change resets pagination
  scope.stop(); // disposes the watcher + any pending timer
});

/**
 * Smoke tests for the React components — server-render (no jsdom) to confirm they
 * mount, emit the `.ps-*` markup, and stay inert before any fetch (effects don't
 * run during renderToStaticMarkup, so no network is touched).
 */
import React from "react"; // tsx transpiles this file with the classic JSX runtime
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PragmaSearch,
  SearchBox,
  Hits,
  RefinementList,
  Pagination,
  usePragmaSearch,
} from "../src/react.js";

test("PragmaSearch renders the .ps-* scaffold and reflects props", () => {
  const html = renderToStaticMarkup(
    <PragmaSearch endpoint="http://localhost:5173" initialQuery="hello" facets={["category"]}>
      <SearchBox placeholder="Find products" />
      <RefinementList attribute="category" />
      <Hits />
      <Pagination />
    </PragmaSearch>,
  );
  assert.match(html, /class="ps-root"/);
  assert.match(html, /class="ps-searchbar"/);
  assert.match(html, /placeholder="Find products"/);
  assert.match(html, /value="hello"/); // initialQuery flows into the input
  assert.match(html, /class="ps-empty"/); // no results before a fetch
  // Inert before fetch: no hits, no facet groups, no pager.
  assert.doesNotMatch(html, /class="ps-hit"/);
  assert.doesNotMatch(html, /class="ps-fgroup"/);
  assert.doesNotMatch(html, /class="ps-pager"/);
});

test("components throw a clear error when used outside <PragmaSearch>", () => {
  assert.throws(() => renderToStaticMarkup(<SearchBox />), /inside <PragmaSearch>/);
});

test("usePragmaSearch is exported as a hook", () => {
  assert.equal(typeof usePragmaSearch, "function");
});

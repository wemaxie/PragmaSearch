# Drop-in search widget

A self-contained, dependency-free search UI you embed on any site (a drop-in
alternative to Algolia InstantSearch). It renders a search box with autocomplete,
a faceted refinement sidebar, highlighted results and pagination — and talks to
your PragmaSearch server's `/api/search`.

Files: `widget/pragmasearch-widget.js` + `widget/pragmasearch-widget.css`. A live
example is served at `/widget` by the demo server (`npm run demo`).

## Use it

**A. From your PragmaSearch server** (it serves the files + sets CORS):

```html
<link rel="stylesheet" href="https://search.yourshop.com/pragmasearch-widget.css">
<div id="search"></div>
<script src="https://search.yourshop.com/pragmasearch-widget.js"></script>
<script>
  PragmaSearch.create({ container: "#search", endpoint: "https://search.yourshop.com" });
</script>
```

**B. From a CDN** (jsDelivr serves any file from the GitHub repo):

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/wemaxie/PragmaSearch/widget/pragmasearch-widget.css">
<script src="https://cdn.jsdelivr.net/gh/wemaxie/PragmaSearch/widget/pragmasearch-widget.js"></script>
```

## Options

```js
PragmaSearch.create({
  container: "#search",        // selector or element (required)
  endpoint: "",                // PragmaSearch server base URL ("" = same origin)
  facets: ["category", "brand"], // fields to show in the refinement sidebar
  hitsPerPage: 12,
  placeholder: "Search…",
  priceFacet: true,            // show price-range facet (needs a numeric `price` field)
  initialQuery: "",
  poweredBy: true,
  renderHit: (hit) => `<div class="ps-hit">…</div>`, // optional custom hit markup
});
// returns { search(q), destroy() }
```

## Theming

Override the CSS variables on `.ps-root`:

```css
.ps-root {
  --ps-accent: #e11d48;
  --ps-bg: #0b0b0f;
  --ps-fg: #f4f4f5;
  --ps-border: #26262b;
  --ps-panel: #16161a;
  --ps-radius: 10px;
}
```

## React

Wrap it in an effect (a full React-component adapter is on the [roadmap](../ROADMAP.md)):

```jsx
import { useEffect, useRef } from "react";

export function Search({ endpoint }) {
  const ref = useRef(null);
  useEffect(() => {
    const inst = window.PragmaSearch.create({ container: ref.current, endpoint });
    return () => inst.destroy();
  }, [endpoint]);
  return <div ref={ref} />;
}
```

## CORS

The widget usually runs on your storefront origin and calls the search API on
another origin, so the server must allow it. The demo server sends
`Access-Control-Allow-Origin` on the read endpoints (`PRAGMA_CORS_ORIGIN`,
default `*`). Set it to your storefront origin in production.

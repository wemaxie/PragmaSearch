# PragmaSearch

**Open-source, local-first semantic search.** Drop in a products JSON, get search that understands _meaning_ — not just keywords — with **no cloud, no API keys, $0**.

> You pay $500/mo for hosted search on a 5,000-product shop? Your laptop in 2026 is more than powerful enough to do it locally, for free.

Search `"something for gaming"` and get back an **RTX 5090** — even though the word "gaming" appears nowhere in its title.

## How it works

1. **Index once** (build time): your products are run through a tiny embedding model that ships with the package, turning each into a vector (a numeric fingerprint of meaning). Saved to a single local file.
2. **Search anytime**: the user's query is embedded locally and matched against the file. ~5–10 ms, fully offline.

No registration. No account. No external service ever sees your data or your users' queries.

## Quick start

```bash
npm install pragmasearch

# build the index from your catalog (the one-time "training" on your own data)
npx pragmasearch index products.json

# search it
npx pragmasearch search "something for gaming"
```

Programmatic API:

```ts
import { buildIndex, saveIndex, loadIndex, createSearcher } from "pragmasearch";

const index = await buildIndex(products);
await saveIndex("pragmasearch-index.json", index);

const searcher = await createSearcher(await loadIndex("pragmasearch-index.json"));
const hits = await searcher.search("something for gaming", 5);
```

## Live demo (server-side)

A ready-to-deploy server-side demo runs over a real 5,041-product catalog
(it-shop.rs, Serbian, multilingual model): hybrid search, typo tolerance, ~40 ms
per query, $0/search. Deploy it on any persistent host (Railway / Render / Fly /
VPS) in a couple of clicks — see **[DEPLOY.md](DEPLOY.md)**.

Run it locally:

```bash
npm install
npm run demo:itshop     # http://localhost:5173
```

Search modes (toggle in the UI): **hybrid** (meaning + keywords + exact-match boost),
**vector** (pure semantic), **keyword** (BM25). Typo tolerance is configurable
(e.g. `opple` → `apple`).

## Status

🚧 Early development. Hybrid keyword + vector search, multilingual support, typo
tolerance, and a CLI are working. A fully client-side browser build and a drop-in
widget are on the roadmap — see [`docs_dev/task_plan.md`](docs_dev/task_plan.md).

## License

MIT

# PragmaSearch

**Open-source, local-first semantic search.** Drop in a products JSON, get search that understands _meaning_ — not just keywords — with **no cloud, no API keys, $0**.

> You pay $500/mo for hosted search on a 5,000-product shop? Your laptop in 2026 is more than powerful enough to do it locally, for free.

Search `"something for gaming"` and get back an **RTX 5090** — even though the word "gaming" appears nowhere in its title.

## How it works

1. **Index once** (build time): your products are run through a tiny embedding model that ships with the package, turning each into a vector (a numeric fingerprint of meaning). Saved to a single local file.
2. **Search anytime**: the user's query is embedded locally and matched against the file. ~5–10 ms, fully offline.

No registration. No account. No external service ever sees your data or your users' queries.

## Quick start

> Not on npm yet — clone the repo and run `npm install`. (`npm install pragmasearch`
> will work once published.)

```bash
# build the index from your catalog (a one-time pass over your own data)
npx pragmasearch index products.json

# search it — try a query whose words aren't in any title
npx pragmasearch search "something for gaming"
```

Runnable example: `npm run example` (indexes a tiny sample and searches it).

Programmatic API:

```ts
import { buildIndex, saveIndex, loadIndex, createSearcher } from "pragmasearch";

const index = await buildIndex(products);
await saveIndex("pragmasearch-index.json", index);

const searcher = await createSearcher(await loadIndex("pragmasearch-index.json"));
const hits = await searcher.search("something for gaming", 5);
```

## Demo server

A small server serves a search UI + `/api/search`, with instant in-browser
autocomplete and a Hybrid / Vector / Keyword toggle:

```bash
npm install
npm run demo            # http://localhost:5173 (English sample catalog)
```

Point it at any catalog and model (e.g. multilingual) by building an index and
passing it: `npx tsx demo/server.ts your-index.json`. In server mode the query is
embedded on **your** host (no third party); ~tens of ms per query, $0/search.
Deploy it on any persistent host (Railway / Render / Fly / VPS) — see
**[DEPLOY.md](DEPLOY.md)**. (A fully client-side, in-browser build — model and all —
is on the [roadmap](ROADMAP.md).)

## Models & languages

Default model is `Xenova/all-MiniLM-L6-v2` (English, ~23 MB). For other languages
use `--model Xenova/multilingual-e5-small` at index time — query/passage prefixes
are applied automatically. The model is stored in the index, so query and document
encoders always match.

## Status

🚧 Early `0.x` — the API and on-disk index format may change. Working today: hybrid
keyword + vector search, configurable typo tolerance, multilingual support, a CLI,
a programmatic API, and the demo server. A fully client-side browser build, faceting,
and a drop-in widget are next — see the [roadmap](ROADMAP.md).

## License

MIT

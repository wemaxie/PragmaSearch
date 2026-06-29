<p align="center">
  <img src="assets/header.png" alt="PragmaSearch — local-first semantic search" width="560">
</p>

<p align="center">
  <b>Free, self-hosted semantic search — a local-first Algolia alternative.</b><br>
  Hybrid <b>vector + keyword</b> search that understands <i>meaning</i>, with typo tolerance,
  multilingual support, zero API keys, and <b>$0 per search</b>.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://github.com/wemaxie/PragmaSearch/actions/workflows/ci.yml"><img src="https://github.com/wemaxie/PragmaSearch/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node >= 20">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6" alt="TypeScript">
  <img src="https://img.shields.io/badge/dependencies-1-success" alt="1 runtime dependency">
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome"></a>
</p>

---

Search **`"something for gaming"`** and get back an **RTX 5090** — even though the word
"gaming" appears nowhere in its title. PragmaSearch runs a tiny embedding model **on your
own machine or server** (no cloud, no API keys), so you replace your hosted-search bill with **$0**.

> Paying $500/mo for hosted search on a 5,000-product shop? Your laptop in 2026 is more than
> powerful enough to do it locally, for free.

<!-- TODO: drop a demo GIF here — typing "for games" → graphics cards. (The single most persuasive thing in this README.) -->

## ✨ Features

- 🧠 **Semantic search** — understands meaning via vector embeddings ([Transformers.js](https://github.com/huggingface/transformers.js)), not just keywords
- 🔀 **Hybrid ranking** — fuses vector + **BM25** keyword search with Reciprocal Rank Fusion, plus an exact-match boost for SKUs/brands/part numbers
- 🔤 **Typo tolerance** — `opple` → `apple`, configurable (length-scaled, à la Algolia)
- 🌍 **Multilingual** — English by default; any language via a multilingual model
- 📦 **Zero infrastructure** — one local index file, the model ships with the package; self-host on a $5 VPS
- 🪶 **One runtime dependency** — just the model runtime. Own your stack.
- ⚡ **Fast** — brute-force cosine + in-memory BM25; no vector database needed for small–mid catalogs

## 🆚 PragmaSearch vs hosted search

|  | Algolia / hosted | **PragmaSearch** |
|---|---|---|
| **Cost** | $ per search / per record | **$0** |
| **Hosting** | their cloud | **your machine / VPS** |
| **API keys / signup** | required | **none** |
| **Your data & user queries** | leave your infrastructure | **stay on your infrastructure** |
| **Semantic (meaning) search** | paid add-on | **built in** |
| **Typo tolerance** | ✅ | ✅ |
| **Facets · pagination · UI widget** | ✅ | 🚧 [on the roadmap](ROADMAP.md) |

> Built for small-to-mid catalogs (≤ ~50k items). For million-SKU real-time catalogs with
> merchandising and analytics, the hosted platforms still win — see the [roadmap](ROADMAP.md).

## 🚀 Quick start

> Not on npm yet — clone the repo and run `npm install`. (`npm install pragmasearch` will work once published.)

```bash
# build the index from your catalog (a one-time pass over your own data)
npx pragmasearch index products.json

# search it — try a query whose words aren't in any title
npx pragmasearch search "something for gaming"
```

Runnable example: `npm run example` (indexes a tiny sample catalog and searches it).

Programmatic API:

```ts
import { buildIndex, saveIndex, loadIndex, createSearcher } from "pragmasearch";

const index = await buildIndex(products);          // embed your catalog once
await saveIndex("pragmasearch-index.json", index); // one local file

const searcher = await createSearcher(await loadIndex("pragmasearch-index.json"));
const hits = await searcher.search("something for gaming", 5);
```

## 🔍 How it works

1. **Index once** (build time): each product is run through a small embedding model that
   ships with the package, turning it into a vector — a numeric fingerprint of meaning.
   Saved to a single local file alongside a BM25 keyword index.
2. **Search anytime**: the query is embedded locally, scored against the vectors (cosine)
   and the keyword index (BM25), fused with RRF, and the top matches are returned in ~tens of ms.

No registration. No account. No third-party service ever sees your catalog or your users' queries.

## 🖥️ Demo server

A small server serves a search UI + `/api/search`, with instant in-browser autocomplete and a
Hybrid / Vector / Keyword toggle:

```bash
npm install
npm run demo            # http://localhost:5173
```

Point it at any catalog/model by building an index and passing it:
`npx tsx demo/server.ts your-index.json`. The query is embedded on **your** host — deploy on any
persistent host (Railway / Render / Fly / VPS), see **[DEPLOY.md](DEPLOY.md)**.

## 🌐 Models & languages

Default model is `Xenova/all-MiniLM-L6-v2` (English, ~23 MB). For other languages, index with
`--model Xenova/multilingual-e5-small` — query/passage prefixes are applied automatically. The
model is recorded in the index, so query and document encoders always match.

## 🗺️ Roadmap

Facets & filtering, pagination, highlighting, a drop-in search widget, and incremental indexing
are next — see **[ROADMAP.md](ROADMAP.md)**. Ideas and use cases welcome via issues.

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PragmaSearch stays small and dependency-light by design.

## 📄 License

[MIT](LICENSE)

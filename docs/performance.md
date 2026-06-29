# Performance & VPS sizing

**TL;DR — to serve search in ~50 ms you need one modern *dedicated* CPU core, not a
cheap *burstable/shared* vCPU.** The whole latency budget is dominated by one thing:
running the embedding model on the user's query. Everything else (the vector scan,
BM25, fusion, faceting) is sub-millisecond to a few milliseconds for catalogs up to
tens of thousands of items.

## Where the time goes

For a single query, in order of cost:

| Step | Cost (English MiniLM, 10k catalog) |
|------|-----------------------------------|
| **Embed the query** (model forward pass) | **~15–40 ms** on a fast core · **~200–400 ms** on a weak shared vCPU |
| Brute-force cosine over the index | ~0.3 ms / 5k items, ~3 ms / 50k items |
| BM25 keyword search + RRF fusion | ~1–3 ms |
| Faceting + filtering | ~1–3 ms |

So **the CPU's single-core speed for the embedding pass is what decides whether you
hit 50 ms.** The catalog size barely matters until ~50–100k items.

## What CPU you need for ~50 ms

The embedding model (MiniLM-L6 q8, ~23 MB) is a small transformer run on the CPU via
ONNX Runtime. It wants **a real, dedicated, modern core** — not a throttled/burstable
share.

**✅ Hits ~50 ms (English MiniLM):** a modern dedicated x86 core (recent AMD EPYC/Ryzen
or Intel). 1 core handles ~20–40 ms embeds; 2 cores let you handle concurrent queries.

| Provider | Plan (example) | vCPU / RAM | Price | Notes |
|----------|----------------|-----------|-------|-------|
| **Hetzner** | CPX11 / CPX21 | 2–3 dedicated AMD / 2–4 GB | ~€4–8/mo | Best value; fast cores |
| **DigitalOcean** | Premium AMD/Intel Droplet | 2 vCPU / 2 GB | ~$18/mo | Modern pinned CPUs |
| **Vultr** | High Frequency | 1–2 vCPU / 2 GB | ~$12/mo | High-clock cores |
| **Linode/Akamai** | Dedicated CPU | 2 vCPU / 4 GB | ~$30/mo | Guaranteed cores |
| **Fly.io** | `performance-2x` | 2 dedicated / 4 GB | usage | Co-locate near users |

**❌ Won't reliably hit 50 ms:** free/hobby shared tiers and burstable instances
(Railway/Render free, AWS `t3`/`t4g` burst, the cheapest "shared CPU" droplets). We
measured ~300 ms for the *embedding* alone on a shared hobby vCPU. They're fine for a
demo, not for a fast production search box.

> The 50 ms is **server compute**. Network round-trip to the user is separate — put the
> server in a region close to your users (or behind a CDN/edge proxy) to keep total
> latency low. PragmaSearch's instant **autocomplete runs in the browser**, so typing
> stays smooth regardless.

## RAM by catalog size

| Catalog | Model in RAM | Index in RAM | Recommended |
|---------|--------------|--------------|-------------|
| ≤ 10k (English MiniLM) | ~200–300 MB | ~15–40 MB | **512 MB – 1 GB** |
| ≤ 50k (English MiniLM) | ~200–300 MB | ~80–200 MB | **1–2 GB** |
| Multilingual (e5-small) | ~400–600 MB | same | **1–2 GB** |

## Scaling notes

- **Search is O(N) per query** (brute-force cosine). That's intentional — it needs no
  vector database and stays simple and fast up to ~50–100k items. Beyond that, shard the
  index or add an ANN backend (on the [roadmap](../ROADMAP.md)).
- **Concurrency is CPU-bound.** Each query embeds on a core; N simultaneous queries want
  ~N cores or they queue. For higher QPS, add vCPUs.
- **Keep the process warm.** The model loads once at startup and stays in RAM. Don't run
  this on serverless that cold-starts (it would re-load the model every time).

## How to make it faster

1. **Use a dedicated modern CPU** (above) — the single biggest lever.
2. **English? Use MiniLM**, not the multilingual e5 model (e5 is ~3–5× slower → expect
   ~80–150 ms on the same CPU). Index with `--model` to choose.
3. **Keep `dtype: q8`** (default) — small and fast with negligible quality loss.
4. **The built-in query-embedding cache** already skips the model for repeated/queued
   queries (autocomplete chips, retries).
5. **Co-locate** the server near your users to cut network latency.
6. For very high throughput, run the embedder in a worker thread/pool so one slow query
   doesn't block others.

## Reproduce the numbers

```bash
npm run demo            # then watch the "ms" each /api/search returns (server compute)
```
The `ms` field in `/api/search` responses is the server-side search time on your hardware.

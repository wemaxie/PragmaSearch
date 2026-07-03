# Deploying the demo server

This deploys the PragmaSearch demo over the bundled sample catalog: hybrid
search, faceting, typo tolerance, autocomplete. The embedding model is held in
RAM, so queries are fast — the browser only sends the query text and gets back
small JSON, like a hosted search box but on your own host for $0/search.

The `Dockerfile` bakes the model into the image and builds the index from
`data/products.json` at build time, so the first request is fast. ~512 MB RAM is
enough for the English model + sample catalog.

> **Why a persistent host (not Vercel)?** The server keeps the model in memory.
> On serverless, every cold start re-loads it and `onnxruntime-node` is a native
> binary that hits function size limits. Use a host that keeps a process warm.

## Option A — Railway (easiest)
1. Push this repo to GitHub.
2. https://railway.app → **New Project → Deploy from GitHub repo** → pick it.
3. Railway detects the `Dockerfile` and deploys; it injects `$PORT` automatically.
4. Open the generated domain (Settings → Networking → Generate Domain).

## Option B — Render (Blueprint)
1. https://render.com → **New + → Blueprint** → connect this repo.
2. Render reads `render.yaml` and builds the Dockerfile.

## Option C — Fly.io
```bash
fly launch        # detects the Dockerfile; pick a region
fly deploy
```

## Option D — Any VPS
```bash
docker build -t pragmasearch .
docker run -d -p 80:5173 --name pragmasearch pragmasearch
# open http://YOUR_SERVER_IP
```

## Run it locally (no Docker)
```bash
npm install
npm run demo        # http://localhost:5173
```

## Endpoints
- `GET /` — the search UI
- `GET /api/search?q=<query>&mode=hybrid|vector|keyword&typo=on|off&offset=<n>&facets=category,brand&filter=<json>`
- `GET /api/meta` — index metadata (also the health check)
- `GET /api/titles` — lightweight list for in-browser autocomplete

## Using your own catalog
Build an index from your products JSON and point the server at it:
```bash
npx pragmasearch index your-products.json --out your-index.json
npx tsx demo/server.ts your-index.json
```
The example query chips in the demo UI are a fixed English set (edit `CHIPS` in `demo/server.ts` to change them).

# Deploying the server-side demo

This deploys the **server-side** PragmaSearch demo over the it-shop.rs catalog
(5,041 real products, Serbian, multilingual model). The model is held in RAM, so
every query is ~40 ms — the browser only sends the query text and gets back small
JSON, exactly like Algolia, but on your own host for $0/search.

> **Why not Vercel?** Vercel is serverless: every cold start would re-download the
> ~118 MB multilingual model and `onnxruntime-node` is a native binary that hits
> Vercel's 250 MB function limit. You'd see multi-second stalls, not "fast". Use a
> **persistent host** instead — the model loads once at boot and stays warm.

Needs **~1 GB RAM** (multilingual model + index in memory). The `Dockerfile` bakes
the model into the image, so the first request is fast (no cold-start download).

## Option A — Railway (easiest)
1. Push this repo to GitHub (done).
2. https://railway.app → **New Project → Deploy from GitHub repo** → pick this repo.
3. Railway detects the `Dockerfile` and deploys. It injects `$PORT` automatically.
4. Open the generated URL. Done.

## Option B — Render (Blueprint)
1. https://render.com → **New + → Blueprint** → connect this repo.
2. Render reads `render.yaml` and builds the Dockerfile. Use the **Starter** plan
   (Free = 512 MB may OOM with the multilingual model).
3. Open the URL.

## Option C — Fly.io
```bash
fly launch        # detects the Dockerfile; pick a region; set VM to >=1GB
fly deploy
```

## Option D — Any VPS (€5 Hetzner/DO/etc.)
```bash
docker build -t pragmasearch .
docker run -d -p 80:5173 --name pragmasearch pragmasearch
# open http://YOUR_SERVER_IP
```

## Run it locally (no Docker)
```bash
npm install
npm run demo:itshop        # -> http://localhost:5173
```

## Endpoints
- `GET /` — the search UI
- `GET /api/search?q=<query>&mode=hybrid|vector|keyword&typo=on|off` — JSON results
- `GET /api/meta` — index metadata (also the health check)

## Switching catalogs
The server takes the index file as an argument:
`npx tsx demo/server.ts <index.json>`, with optional env `PRAGMA_CHIPS` (pipe-separated
example queries). Regenerate an index with `npm run index:itshop` (or `index:10k`, etc.).

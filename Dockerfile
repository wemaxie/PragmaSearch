# PragmaSearch — server-side demo (English sample catalog).
# Runs the search server with the model held in RAM, so every query is fast.
# Deploy on any persistent host: Railway, Fly.io, Render, or a small VPS.
FROM node:20-slim

# onnxruntime-node needs glibc (present in node:20-slim). Bake the model into the image.
ENV NODE_ENV=production
ENV PRAGMA_MODEL_CACHE=/app/.models
WORKDIR /app

# Install dependencies (tsx is used to run the TypeScript server).
COPY package.json package-lock.json* ./
RUN npm install

# Bake the embedding model into its OWN cached layer so normal code edits don't
# re-download it on every deploy.
COPY scripts/prewarm.ts ./scripts/prewarm.ts
RUN npx tsx scripts/prewarm.ts Xenova/all-MiniLM-L6-v2 q8 || echo "prewarm skipped"

# App source + the committed sample catalog.
COPY . .

# Build the index from the committed sample (fast; model already prewarmed). If this
# fails for any reason, the server rebuilds it from data/products.json at startup.
RUN npx tsx src/cli.ts index data/products.json --out pragmasearch-index.json || echo "index build deferred to startup"

# Hosts inject $PORT; the server reads it (defaults to 5173 locally).
EXPOSE 5173
CMD ["npx", "tsx", "demo/server.ts"]

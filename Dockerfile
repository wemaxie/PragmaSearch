# PragmaSearch — server-side demo (it-shop.rs catalog, multilingual).
# Runs the search server with the model held in RAM, so every query is ~40ms.
# Deploy on any persistent host: Railway, Fly.io, Render, or a small VPS.
FROM node:20-slim

# onnxruntime-node needs glibc (present in node:20-slim). Bake the model into the image.
ENV NODE_ENV=production
ENV PRAGMA_MODEL_CACHE=/app/.models
WORKDIR /app

# Install dependencies (tsx is used to run the TypeScript server).
COPY package.json package-lock.json* ./
RUN npm install

# App source + the committed catalog index.
COPY . .

# Pre-download the multilingual model into the image so the first request is fast
# (no cold-start download). Falls back to a runtime download if the build has no network.
RUN npx tsx scripts/prewarm.ts Xenova/multilingual-e5-small q8 || echo "prewarm skipped"

# Serbian example queries shown as chips in the UI.
ENV PRAGMA_CHIPS="nešto za gejming|bežične slušalice|punjač za laptop|opple airpods|brzi SSD disk|miš za igrice"

# Hosts inject $PORT; the server reads it (defaults to 5173 locally).
EXPOSE 5173
CMD ["npx", "tsx", "demo/server.ts", "pragmasearch-index-itshop.json"]

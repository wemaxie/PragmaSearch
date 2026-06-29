# Contributing to PragmaSearch

Thanks for your interest! PragmaSearch aims to stay small, dependency-light, and
local-first. Contributions that keep it that way are very welcome.

## Setup

```bash
git clone https://github.com/wemaxie/PragmaSearch
cd PragmaSearch
npm install
npm run typecheck   # types
npm test            # unit tests (no model download)
npm run build       # produce dist/
npm run demo        # local search UI on http://localhost:5173
```

The CLI and engine run on TypeScript via `tsx` in dev; `npm run build` (tsup)
produces the published `dist/`.

## Guidelines

- **Keep runtime dependencies minimal.** Today the only runtime dependency is
  `@huggingface/transformers`. New runtime deps need a strong justification.
- **Add a test** for any behavior change in the engine (`src/`). Unit tests live
  in `test/` and must not require a model download.
- Run `npm run typecheck && npm test && npm run build` before opening a PR.
- Match the existing style; no formatter config is enforced, just keep it clean.

## Reporting bugs / ideas

Open an issue with a minimal repro (a small `products.json` + the query) where
possible. For security issues, see [SECURITY.md](SECURITY.md) — please do not
open a public issue.

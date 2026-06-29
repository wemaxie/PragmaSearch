---
name: Bug report
about: Something isn't working as expected
title: ""
labels: bug
---

**What happened**
A clear description of the bug.

**Minimal reproduction**
The smallest `products.json` (or a few rows) + the query/options that reproduce it:

```json
[{ "id": 1, "title": "..." }]
```
```ts
// model, mode, filter, etc.
await searcher.search("...", 10, { /* ... */ });
```

**Expected vs actual**
What you expected, and what you got.

**Environment**
- PragmaSearch version / commit:
- Node version:
- Model (`--model`) and dtype:
- OS:

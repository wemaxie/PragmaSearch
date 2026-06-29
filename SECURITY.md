# Security Policy

PragmaSearch is a library + a small demo server. If you deploy the server mode
publicly, note that it embeds and searches **arbitrary catalog data you provide**.

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.
Use GitHub's [private vulnerability reporting](https://github.com/wemaxie/PragmaSearch/security/advisories/new)
or email the maintainer. We'll acknowledge within a few days.

## Notes for self-hosters

- The demo server validates and clamps input, rate-limits `/api/search`, sends a
  restrictive CSP, and never reflects internal errors to clients. Still, put it
  behind your own proxy/WAF for production traffic.
- The browser demo only emits `http(s)` URLs from product data into the DOM and
  HTML-escapes all rendered fields. If you build your own UI on the API, do the
  same — product data is untrusted input.
- Model weights are downloaded from the Hugging Face Hub on first run. Pin/host
  them yourself if you need a fully air-gapped deployment.

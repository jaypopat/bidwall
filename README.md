# Bidwall quote observations

Hourly Jupiter sell quotes for five xStocks into USDC, written by
`.github/workflows/quote-observer.yml` on `main`. Quotes only; nothing here executed.

- `quotes/YYYY-MM-DD.jsonl`: one summary line per run (schema `bidwall.quote-observation/v1`).
- `quotes/raw/*.json.gz`: every raw HTTP exchange for that run; its SHA-256 is in the summary line.

Summarise with `bun scripts/quotes/report.ts --data quotes` from a `main` checkout.

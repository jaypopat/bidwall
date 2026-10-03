# Quote observer

Hourly evidence of how much tokenized-stock collateral the on-chain market can
absorb, and how that changes when the US market is shut.

**What it records:** Jupiter sell quotes into USDC for NVDAx, TSLAx, AAPLx,
METAx and SPYx at $10k, $50k, $100k, $250k, $500k and $1M, plus the exact NVDAx
lot the Bidwall demo settles (396,422,366 raw atoms). Each run is labelled with
its US market session in New York time.

**What it does not record:** executions. Every record says "Mainnet Jupiter
quote, not executed". The reference price is Jupiter's, not Kamino's oracle.

## Run it

```sh
bun scripts/quotes/observe.ts --out /tmp/bidwall-quotes   # one run, about 40 s
bun scripts/quotes/report.ts --data /tmp/bidwall-quotes    # summary table
npm run test:quotes                                        # offline tests
```

## The hourly series

`.github/workflows/quote-observer.yml` runs at minute 7 of every hour and
commits to the `evidence/quotes` branch, never `main`. To read it:

```sh
git fetch origin evidence/quotes
git worktree add ../bidwall-evidence evidence/quotes
bun scripts/quotes/report.ts --data ../bidwall-evidence/quotes
```

Each `quotes/YYYY-MM-DD.jsonl` line is one run; its `raw.path` points to the
gzip file holding every HTTP exchange, and `raw.sha256` lets you check it.

## Limits

- GitHub may start scheduled runs late; `observedAt` is the real start time.
- Jupiter may rate-limit shared GitHub runners. Failed quotes are kept as
  `error` records. If they dominate, run the same command on a local timer.
- Deviation is measured against Jupiter's own price, at one instant, for a
  single sale. Real liquidations can be partial and paced.

Design: [`superpowers/specs/2026-10-03-quote-observer-design.md`](superpowers/specs/2026-10-03-quote-observer-design.md).

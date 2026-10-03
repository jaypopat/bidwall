# Quote observer: design

3 October 2026 · status: awaiting review

## Purpose

Replace the single 20 September quote snapshot with a reproducible, hourly time
series of Jupiter sell quotes for tokenized stocks into USDC. The series is
evidence for the Colosseum submission (due 12 October 2026, 11:59pm PT), input to
the upcoming risk monitor, and the data behind the explainer's slippage chart.

The key comparison is **exit depth while the US market is shut versus during
regular trading hours**, measured at liquidation-sized lots, including the exact
NVDAx lot the Bidwall demo settles.

Success means any stored observation can be inspected without ambiguity about
token identity, quantity, units, time, market session, or whether anything
executed (nothing does).

## Decisions already made

- Time series, not a one-off snapshot (option B).
- TypeScript run by Bun; pnpm stays the package manager; strict `tsc --noEmit`
  gates CI. Existing JavaScript scripts migrate to TypeScript in a separate plan
  after this ships.
- Hourly runs on GitHub Actions in the private `jaypopat/bidwall` repository.

## Scope

**In scope:** read-only quote collection, verification of token identity, market
session labels, append-only storage, a summary report, tests, the scheduled
workflow.

**Out of scope:** executing or simulating swaps, comparing against Kamino's Scope
oracle, console UI, the risk monitor, additional assets beyond the five below,
migrating existing scripts.

## What is measured

Each run quotes `ExactIn` sells of each token into USDC
(`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, 6 decimals) at `slippageBps=50`.

| Symbol | Mint                                          | Decimals |
| ------ | --------------------------------------------- | -------- |
| NVDAx  | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | 8        |
| TSLAx  | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` | 8        |
| AAPLx  | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | 8        |
| METAx  | `Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu` | 8        |
| SPYx   | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | 8        |

Lots per token: notional ladder of $10k, $50k, $100k, $250k, $500k and $1M,
converted to raw atoms at that run's reference price. NVDAx additionally quotes
the demo lot of exactly `396422366` raw atoms. That is 31 quotes per run.

**Reference price:** Jupiter token API `usdPrice` with its `priceBlockId`,
recorded per token per run and labelled as Jupiter's price, not the lender's
oracle.

**Token verification:** tokens are looked up by mint, never by symbol. If the
token API's `decimals` or mint disagrees with the allowlist, that token's quotes
are skipped and the record states the mismatch.

## Arithmetic

All token amounts are `bigint` raw atoms; prices arrive as JSON numbers and are
converted once to a fixed-point `bigint` with 12 decimal places.

- Lot size: `inAtoms = floor(notionalUsd × 10^decimals / referencePrice)`.
- Deviation in basis points, signed:
  `deviationBps = (outAtoms × 10^decimals × 10^4) / (inAtoms × referencePrice × 10^6) − 10^4`,
  computed in `bigint` with the price's fixed-point scale applied, rounded toward
  negative infinity so deviations are never flattered.
- Percentages are formatted from basis points for display only.

## Market session

Classified from the run's UTC timestamp in `America/New_York` using `Intl`
(handles daylight saving with no dependencies):

| Session       | New York time                                                               |
| ------------- | --------------------------------------------------------------------------- |
| `pre-market`  | Mon–Fri 04:00–09:30                                                         |
| `regular`     | Mon–Fri 09:30–16:00                                                         |
| `after-hours` | Mon–Fri 16:00–20:00                                                         |
| `overnight`   | Mon–Thu 20:00 to next day 04:00                                             |
| `weekend`     | Fri 20:00 to Mon 04:00                                                      |
| `holiday`     | All day on a 2026 NYSE full-day closure date (none fall before 26 November) |

Weekend and holiday take precedence over the time-of-day rows.

The record also stores the New York local time string so a reader can check the
label.

## Storage

Data lives on a dedicated branch, `evidence/quotes`, so hourly bot commits never
touch `main`. Layout on that branch:

- `quotes/YYYY-MM-DD.jsonl`: one summary line per run (UTC date).
- `quotes/raw/YYYY-MM-DDTHH-MM-SSZ.json.gz`: every raw token and quote response
  from the run, gzip-compressed. The summary line stores this file's path and
  SHA-256.

Summary line schema (`schema: "bidwall.quote-observation/v1"`):

```ts
type Observation = {
  schema: "bidwall.quote-observation/v1";
  label: "Mainnet Jupiter quote, not executed";
  observedAt: string; // ISO UTC, when the run started
  newYorkTime: string; // e.g. "2026-10-03 17:05 EDT"
  session: Session;
  runner: "github-actions" | "local";
  slippageBps: 50;
  endpoints: { quote: string; tokens: string };
  tokens: TokenObservation[];
  raw: { path: string; sha256: string };
};
type TokenObservation = {
  symbol: string;
  mint: string;
  decimals: number;
  status: "ok" | "skipped";
  skipReason?: string;
  referencePriceUsd?: string; // decimal string as received
  priceBlockId?: number;
  liquidityUsd?: string;
  quotes: QuoteObservation[];
};
type QuoteObservation = {
  lot: "demo-lot" | `usd-${number}`;
  inAmountRaw: string;
  notionalUsd: string; // at reference price
  status: "ok" | "no-route" | "error";
  error?: string;
  outAmountRaw?: string;
  minOutAmountRaw?: string; // Jupiter otherAmountThreshold
  deviationBps?: number;
  priceImpactPct?: string;
  contextSlot?: number;
  routeLabels?: string[];
};
```

`bigint` values are serialized as decimal strings.

## Components

All under `scripts/quotes/`. Code uses only web-standard and `node:` APIs so it
type-checks against `@types/node` and runs under Bun.

| File         | Responsibility                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| `tokens.ts`  | The allowlist above and the lot ladder                                                               |
| `units.ts`   | Price parsing to fixed point, lot sizing, deviation in basis points                                  |
| `session.ts` | `classifySession(date)` and the New York time string                                                 |
| `jupiter.ts` | Typed `getTokens(mints)` and `getQuote(params)` with validators that fail closed; injectable `fetch` |
| `observe.ts` | `runObservation(deps)` builds one `Observation`; CLI entry writes summary and raw files              |
| `report.ts`  | Reads JSONL files and prints median deviation by token, lot and session as a Markdown table          |

## Network behaviour

- One token API call per run using comma-separated mints, then quotes in
  sequence with 1 second between requests (about 40 seconds per run).
- One retry after 3 seconds on HTTP 429 or 5xx; otherwise the quote is recorded
  as `error` with the status code.
- A response with no route is recorded as `no-route`.
- Every response body is validated before use; an unexpected shape is recorded
  as `error` rather than guessed at.
- The CLI exits non-zero only when every quote in the run failed, so the
  workflow surfaces total outages without failing on partial gaps.

## Scheduled workflow

`.github/workflows/quote-observer.yml` on `main`:

- Triggers: `schedule` at minute 7 of every hour, plus `workflow_dispatch`.
- `permissions: contents: write`; `concurrency: quote-observer` so runs never
  overlap.
- Checks out `main` for code and `evidence/quotes` into a separate directory,
  installs Bun and dependencies with the frozen lockfile, runs
  `bun scripts/quotes/observe.ts --out <data dir> --runner github-actions`, then
  commits and pushes to `evidence/quotes` (rebasing once if the push races).
- The `evidence/quotes` branch is created once as an orphan branch containing
  only a README describing the data.

Known risks: GitHub can delay scheduled runs, so `observedAt` records the real
start time; Jupiter may rate-limit shared runner IPs, which shows up as `error`
records. If errors dominate, fall back to a local timer running the same CLI.
About 9 days × 24 runs × ~1 minute stays well inside private-repo Actions
minutes.

## Report

`bun scripts/quotes/report.ts --data <dir>` prints, for each token and lot, the
median deviation in each session plus the observation count, and the share of
runs with no route. It is the source for figures cited in the pitch and for the
explainer's chart refresh.

## Testing

`bun test tests/quotes`, no network:

- `units`: price parsing (integers, decimals, exponent inputs rejected), lot
  sizing, deviation sign and rounding against hand-computed cases, including the
  live NVDAx response captured on 3 October.
- `session`: each session boundary, both 2026 daylight-saving transitions,
  Friday 20:00 into weekend, and a holiday.
- `jupiter`: validators accept captured real responses and reject missing or
  mistyped fields; retry happens once on 429 and not on 400.
- `observe`: a full run with a fake `fetch` produces the expected `Observation`,
  records `no-route` and mismatch cases, and computes the raw file hash.

`tsc --noEmit` against a strict `tsconfig.scripts.json` covering
`scripts/quotes` and `tests/quotes` is added to `npm run ci`. The one new
development dependency is `@types/bun` for `bun:test` types.

## Package scripts

- `quotes:observe`: `bun scripts/quotes/observe.ts`
- `quotes:report`: `bun scripts/quotes/report.ts`
- `test:quotes`: `bun test tests/quotes`
- `typecheck:scripts`: `tsc --noEmit -p tsconfig.scripts.json`

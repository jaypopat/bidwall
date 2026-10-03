# Market risk monitor

The monitor reads indebted loans in Kamino’s public xStocks market and estimates
collateral released by a first liquidation under 31 price scenarios: baseline,
each of nine tracked xStocks at −10/−20/−30%, and all nine together at those drops.
It compares that release with the latest recorded Jupiter sell ladder.

## Run it

`SOLANA_RPC_URL` is read only on the server/CLI. Put a mainnet RPC URL in
`.env.local`; Bun and Next.js load it automatically. When unset or empty, the
monitor uses public mainnet RPC, which may reject or rate-limit account scans.
The GitHub workflow reads the same variable from its repository secret.

```sh
# Read the latest evidence branch without mixing data into main.
git fetch origin evidence/quotes
git worktree add ../bidwall-evidence evidence/quotes

# Capture one risk snapshot and its raw decoded inputs.
bun scripts/risk/snapshot.ts --quotes ../bidwall-evidence/quotes --out /tmp/bidwall-risk

# Open the console, then click Market risk → Scan market.
npm run dev

# Offline checks.
npm run test:risk
npm run ci
```

The console reads `EVIDENCE_DIR` as the **quotes directory**, defaulting to
`../bidwall-evidence/quotes`. Set it in `.env.local` to use another directory.
`GET /api/risk` performs a new scan; concurrent requests share only the in-flight
scan. Its results are not saved to disk. The CLI writes:

- `risk/YYYY-MM-DD.jsonl`: scenario summaries and scan metadata.
- `risk/raw/<timestamp>.json.gz`: decoded loan inputs, baseline health, reserves
  and market configuration. The summary includes the compressed file’s SHA-256.
- An error summary line when a scan fails, with no fabricated zero exposure.

The hourly quote workflow also writes `risk/` on `evidence/quotes`. Risk scanning
runs even after a quote failure; both outputs are committed together. GitHub
schedules use the code on the default branch, so the workflow change takes effect
after the implementation reaches that branch.

## Read the figures

All dollars are decimal strings derived from bigint micro-dollar arithmetic.
Loan debt and loan counts repeat under each collateral an affected loan holds;
scenario totals count each loan once. Released quantities are raw token atoms.

Depth joins by mint and decimals. It interpolates the first crossing of the
minimum-bonus deviation boundary between adjacent successful ladder lots.
It never crosses a missing or failed lot. An error before the first usable quote
leaves depth unknown; an observed no-route result or a bad $10k quote uses zero
as a lower bound. A good final lot, or a gap after a good lot, yields a lower
bound at that last measured size. `≥` and `≤` show depth and shortfall bounds.

For each scenario, both the release and the observed depth are valued at the
shocked Kamino oracle price. The quote curve is held fixed **in token units**.
Its deviations were measured against Jupiter’s own reference price at the
recorded quote time. This is a comparison with observed liquidity, not a forecast
of prices or DEX liquidity after the shock. Scanning again refreshes loans, not
quotes; run the quote observer separately to obtain newer depth observations.

The local demo’s original $1,500 NVDAx commitment (or captured remaining escrow
after settlement) is displayed alongside. It is local test capacity only and
does not cover mainnet loans.

## Model limits and verification

- Two confirmed RPC reads record separate slots. Reserves cannot be older than
  the loan read, but the reads are not an atomic snapshot.
- Deposit exchange rates subtract protocol, referrer and pending-referrer fees.
  Loan debt omits interest since the obligation’s last refresh. Stored reserve
  oracle prices may be stale; each update time is included in the snapshot.
- Liquidatability compares borrow-factor adjusted debt with the weighted
  liquidation threshold. Elevation groups are excluded and counted with a reason.
- A first repayment prioritises the highest-borrow-factor debt reserve, then the
  largest value among ties. It uses the decoded close factor, 100% above the
  decoded insolvency threshold, the selected debt-leg limit, the per-liquidation
  market cap, and full repayment below the selected leg’s dust threshold.
- Released collateral is allocated in proportion to shocked deposit value, using
  the larger minimum bonus of the collateral and selected debt reserve. It is
  capped at each deposit and rounded down. Kamino’s actual collateral priority,
  dynamic/near-insolvency bonus, protocol liquidation fees, liquidity limits and
  repeated liquidations are not reproduced. No transaction is constructed.

Layouts and rules were checked against [Kamino’s published code](https://github.com/Kamino-Finance/klend/blob/master/programs/klend/src/state/liquidation_operations.rs)
and installed klend-sdk 12.0.0. The [unchanged mainnet fixtures](../tests/risk/fixtures/README.md)
contain seven loans and 12 reserves at slots 453057000/453057011. The optional
SDK cross-check is `bun spikes/kamino-cpi/verify-risk.mjs`; it needs the spike’s
dependencies. SDK 12.0.0 also imports an undeclared memo package, so if that
command reports it missing, install it only in the isolated spike:

```sh
npm install --no-save --package-lock=false --ignore-scripts --prefix spikes/kamino-cpi @solana-program/memo@0.7.0
```

The monitor itself imports only Node built-ins and the existing quote helpers.
A 1,696-loan scan generated about 312 KB of compressed raw data plus an 84 KB
summary. This is intentionally a small evidence collector, not a production
liquidation service.

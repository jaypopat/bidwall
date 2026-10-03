# Risk monitor: design

3 October 2026 · status: reviewed and implemented

## Purpose

Answer, with on-chain data: **for each xStock in Kamino's public xStocks market,
how much collateral would a liquidation wave release if its price fell 10%, 20%
or 30%, and could the DEX absorb it within the liquidation bonus?** The answer
picks the asset the pitch and demo lead with, and shows a curator the gap a
committed Bidwall bid would fill.

Success: every figure traces to a recorded slot, a named scenario and stated
simplifications, and nothing is presented as Kamino's exact liquidation output.

## Decisions already made

- Read directly from mainnet (Kamino's API has no loan endpoints).
- Per-asset shocks and a market-wide shock, each at −10%, −20%, −30%.
- Hourly snapshots in the existing quote workflow, plus an on-demand console view.
- `SOLANA_RPC_URL` (a Helius mainnet URL) from a GitHub secret or `.env.local`;
  public RPC when unset. Used only server-side.
- Own zero-dependency decoders in Bun/strict TypeScript, not Kamino's SDK.
- No indexer, no separate CLI report, no evidence-branch rename.

## Scope

**In:** decoding loans, reserves and the market config; valuation and the
liquidation rule; scenarios; joining with the latest quote ladder; hourly
storage; an API route and "Market risk" console view.

**Out:** other Kamino markets; elevation-group rules (no indebted loan in this
market uses one; any that appear are counted as not modelled); interest accrued
since a loan's last refresh; Kamino's dynamic bonus above the minimum; liquidator
behaviour beyond a first liquidation; any transaction.

## Data source

One snapshot makes two JSON-RPC calls:

1. `getProgramAccounts` on Kamino Lending (`KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`)
   with filters: size 3344, market `5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua`
   at offset 32, `hasDebt = 1` at offset 2287 (about 1,700 loans on 3 October),
   `withContext: true` for the slot.
2. `getMultipleAccounts` for every reserve referenced by those loans, plus the
   market account, with `minContextSlot` set to the loan read’s slot.
   Both slots are recorded; these reads are not an atomic snapshot.

## Decoded fields

Offsets come from Kamino's published layouts and were checked against live
accounts on 3 October (NVDAx price matched Jupiter within 0.1%; USDC lent matched
Kamino's API). Scaled fractions (`Sf`) are `u128` with 60 fractional bits.

| Account                    | Field                                                                                                        | Offset                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------- |
| Obligation (3344 bytes)    | market, owner                                                                                                | 32, 64                  |
|                            | deposits: 8 × 136 bytes from 96 (reserve +0, cTokens `u64` +32)                                              | 96                      |
|                            | borrows: 5 × 200 bytes from 1208 (reserve +0, `borrowedAmountSf` +88)                                        | 1208                    |
|                            | elevation group `u8`                                                                                         | 2285                    |
| Reserve (8624 bytes)       | market                                                                                                       | 32                      |
|                            | liquidity mint, total available `u64`, borrowed `Sf`, price `Sf`, decimals `u64`                             | 128, 224, 232, 248, 272 |
|                            | protocol, referrer, pending referrer fees `Sf`                                                               | 344, 360, 376           |
|                            | collateral mint supply `u64`                                                                                 | 2592                    |
|                            | liquidation threshold % `u8`, min liquidation bonus bps `u16`                                                | 4873, 4874              |
|                            | borrow factor % `u64`                                                                                        | 5008                    |
| LendingMarket (4664 bytes) | close factor % `u8`, insolvency LTV % `u8`, min full-liquidation value `u64`, max debt per liquidation `u64` | 126, 127, 128, 136      |

Each decoder checks owner program, size and 8-byte discriminator and fails
closed. Symbols come from the observer's allowlist plus USDC, cbBTC and USDG;
anything else shows as its mint.

## Valuation

Money is `bigint` micro-dollars.

- Underlying per cToken = (available + borrowed − all three fees) ÷ collateral mint supply.
- Deposit value = cTokens × that rate × price ÷ 10^decimals.
- Debt value = borrowed × price ÷ 10^decimals; adjusted debt = debt value × borrow factor ÷ 100.
- **Liquidatable** when total adjusted debt ≥ Σ deposit value × liquidation threshold ÷ 100
  (Kamino's own rule). Debt is as of each loan's last refresh.

## Scenarios

`baseline` (no shock), `<SYMBOL> −10/−20/−30%` for each tracked xStock, and
`all xStocks −10/−20/−30%`. Shocks scale the oracle price of the named xStocks;
USDC, USDG and cbBTC are unchanged.

For each loan liquidatable under a scenario, a **first liquidation** is estimated:

- select one debt leg: highest borrow factor, then largest value among ties;
- repay = total debt value (not borrow-factor adjusted) × close factor (20%),
  capped at the selected debt leg and market maximum ($1M). Above the market
  insolvency threshold (95% adjusted debt / deposit value), close factor is 100%.
  A selected debt leg worth less than the full-liquidation minimum ($2) is repaid in full;
- released value = repay × (1 + the larger minimum bonus of the collateral and selected debt reserve);
- released value is split across the loan's collateral in proportion to shocked
  deposit value, capped at each deposit and rounded down to token atoms. This
  deliberately approximates Kamino’s collateral-priority selection, dynamic
  bonus (including near-insolvency caps), protocol fees and execution limits.

These parameters are decoded per scan rather than hardcoded. Emergency mode or
disabled price-triggered liquidations produce zero release in these price scenarios.

## Exit depth and shortfall

Input: the most recent quote observation (`bidwall.quote-observation/v1`).
For each mint, **absorbable atoms** = the largest size whose sell deviation is
no worse than −(minimum bonus): linear interpolation between ladder lots where
the boundary is crossed; the $1M lot’s atoms when it is never crossed (a lower bound); 0 when even
$10k is worse (also a lower bound, since smaller lots were not measured). A
missing/error quote before any usable lot means "unknown"; after a usable lot,
only that earlier lot is a lower bound. No-route results bound depth at the
previous usable lot. Interpolation never crosses gaps or errors.

Absorbable atoms and released atoms are both valued at each scenario’s shocked
Kamino oracle price. The observed quote curve stays fixed in token units; the
monitor does not predict DEX depth after a shock. The bonus-sized deviation is
a comparison heuristic against Jupiter’s reference, not a guaranteed liquidation
profit after fees. Stored reserve oracle prices may be stale; their update times
are recorded.

Shortfall = max(0, released USD − absorbable USD), or unknown when depth is
unknown. When depth is a lower bound, the reported shortfall is an upper bound.

## Output

Per scenario, per collateral symbol:

| Field                                     | Meaning                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `liquidatableDebtUsd`                     | Debt of loans liquidatable under the scenario that hold this collateral |
| `releasedUsd`, `releasedAtoms`            | Collateral released by first liquidations                               |
| `absorbableUsd`, `absorbableIsLowerBound` | From the quote ladder                                                   |
| `shortfallUsd`, `shortfallIsUpperBound`   | Estimated released value beyond observed depth; unknown without quotes  |
| `loans`                                   | Count of liquidatable loans holding this collateral                     |

A loan holding several collateral symbols counts under each, so per-symbol debt
and loan counts are not summed; each scenario also reports its own totals.

Plus per snapshot: both RPC slots, time, session, RPC host (never the key), loans read,
loans not modelled with reasons, and the quote observation time used.

## Components

`scripts/risk/` (validators reused from `scripts/quotes/validate.ts`):

| File           | Responsibility                                                          |
| -------------- | ----------------------------------------------------------------------- |
| `kamino.ts`    | Program, market and token addresses; account decoders                   |
| `rpc.ts`       | The two JSON-RPC calls with injectable `fetch`, timeout and one retry   |
| `valuation.ts` | Exchange rate, values, liquidation rule                                 |
| `scenarios.ts` | Shocks, first-liquidation estimate, absorbable depth, per-symbol totals |
| `snapshot.ts`  | Builds a snapshot; CLI entry writes it                                  |

## Hourly job

A step after the quote step in `.github/workflows/quote-observer.yml`:
`bun scripts/risk/snapshot.ts --quotes evidence/quotes --out evidence/risk`, with
`SOLANA_RPC_URL` from secrets. On the evidence branch:

- `risk/YYYY-MM-DD.jsonl`: one summary line per run (schema `bidwall.risk-snapshot/v1`);
- `risk/raw/<timestamp>.json.gz`: compact per-loan rows (address, deposits and
  debts with symbols, exact scaled amounts and values, health), plus decoded
  reserve and market inputs, with its SHA-256 in the summary. A live 1,696-loan
  run used about 312 KB compressed; the summary is about 84 KB.

A failed scan records an error line; the quote step is unaffected. Risk runs
even when quotes fail, so missing depth does not hide loan exposure.

## Console view

- `GET /api/risk` (server only): runs a live snapshot and pairs it with the latest
  quote observation read from `EVIDENCE_DIR` (default `../bidwall-evidence/quotes`);
  responds with the snapshot and the quote age.
- A "Market risk" view: a scenario picker; a per-symbol table of the output
  fields; slot, time and quote age; the simplifications above in plain words;
  and the demo bid's committed capacity alongside for comparison.

## Testing

- Decoders: real NVDAx, GOOGLx and USDC reserves, the market account and real
  loans captured on 3 October as fixtures; rejection of wrong owner, size,
  discriminator and market.
- Valuation and scenarios: hand-computed cases, including multi-collateral split,
  the $1M cap, the full-liquidation minimum, and an elevation-group loan counted
  as not modelled.
- Absorbable depth: crossing between lots, never crossed, crossed below $10k,
  missing quotes.
- One-off build check: recomputed health for several live loans compared with
  Kamino's SDK in `spikes/kamino-cpi`.

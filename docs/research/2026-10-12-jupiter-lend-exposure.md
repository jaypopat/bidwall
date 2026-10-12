# Jupiter Lend xStock exposure, measured 12 October 2026

Follow-up to the [Kamino xStocks risk review](2026-10-04-kamino-xstocks-risk.md).
Question: Kamino's xStocks market runs about 23% aggregate LTV and showed no
single-name shortfall in 36 snapshots (4–12 Oct). Jupiter Lend advertises much
higher thresholds. Does the aggressive lender carry the gap Bidwall would fill?

**Answer: not in plausible scenarios.** Borrowers keep their own LTVs low. The
only measurable gap is an index crash of about 30% while the oracle is frozen,
concentrated in QQQx.

## Kamino context (same day)

- About $23M of xStock collateral backs about $5.2M of USDC debt.
- The binding constraint is USDC supply: utilisation was 86–92% from July to
  October and supply has stayed flat at about $5.7M. Deposit caps are mostly
  25–50% used; GOOGLx is 83% (10,010 of 12,000), AAPLx 68%, NVDAx 59%.
- Raising Kamino LTVs would not increase borrowing; the USDC is not there.

## Jupiter Lend vaults

Eight xStock vaults (ids 77–84: TSLAx, SPYx, QQQx, NVDAx against USDC and JupUSD).
Liquidation threshold 85% for SPYx/QQQx, 75% for TSLAx/NVDAx; liquidation max
limit 90%; penalty 3%. Positions above the max limit are absorbed by the vault.

| Measure                    |              Value |
| -------------------------- | -----------------: |
| Collateral                 |            $14.25M |
| Debt                       |             $4.79M |
| Positions read / with debt |      7,369 / 1,630 |
| Debt at LTV ≥ 70%          | ~$585k (about 12%) |
| Debt at LTV ≥ 75%          |  ~$200k (about 4%) |
| Highest LTV (SPYx, QQQx)   |       75.2%, 76.4% |

## Stress: price falls with no liquidation in between (weekend gap)

Liquidated positions are restored to the threshold with a 3% penalty; positions
pushed past 90% are absorbed and their collateral still has to be sold.

| Asset | −15%      | −20%                      | −30%                      |
| ----- | --------- | ------------------------- | ------------------------- |
| SPYx  | $40k sold | $49k sold, $210k absorbed | $60k sold, $992k absorbed |
| QQQx  | $63k sold | $26k sold, $178k absorbed | $6k sold, $733k absorbed  |
| TSLAx | $8k sold  | $27k sold, $1k absorbed   | $45k sold, $70k absorbed  |
| NVDAx | $1k sold  | $2k sold                  | $33k sold, $3k absorbed   |

Weekend sell depth within the 3% penalty (Jupiter quotes, 11–12 Oct): SPYx and
NVDAx about $1M, TSLAx and QQQx about $0.45–0.5M.

- At −20%, every asset's sale fits within observed depth.
- At −30%, QQQx needs roughly $0.8M of collateral sold against about $0.45M of
  depth: a shortfall of about $350k, before Kamino's liquidations compete for the
  same depth. SPYx is marginal (about $1.1M against about $1M).
- For SPYx/QQQx the band between threshold (85%) and max limit (90%) is only
  about 6% of price. A gap of that size past a position's liquidation point skips
  the liquidators entirely and lands on the vault. That is the structural spot
  where a committed buyer would act.

## Conclusion

Both Solana xStock lenders are safe under plausible moves today. Jupiter Lend's
high thresholds do not translate into risk because borrowers sit well below them.
Bidwall's value is confined to a tail: an index crash of about 30% across a
frozen-oracle window. QQQ has not fallen 30% in a day in modern history (March
2020 worst day was about −12%). This supports an honest "insurance for the tail"
framing, not an urgent-pain framing.

## Method and caveats

- Vault parameters, totals and liquidation oracle prices: `lite-api.jup.ag/lend/v1/borrow/vaults`.
- Positions: one `getProgramAccounts` per vault through `@jup-ag/lend-read` 0.4.0's
  Anchor program, filtered on `vaultId`. Debt = collateral × 1.0015^tick (the SDK's
  own formula), minus dust debt.
- Raw amounts are scaled to the API's vault totals. The factors came out at
  exactly 0.1 (8→9 decimals) and 0.001 (6→9), confirming 9-decimal normalisation.
  The highest SPYx LTV (75.2%) matches the vault's top tick (about 74.6%).
- Positions already in a liquidated branch are not adjusted; both vaults
  reported zero absorbed debt at read time.
- Depth is measured against the oracle in calm conditions; real crash depth is
  likely thinner, so the −30% shortfall is a lower bound.
- Scratch scripts and data: `/tmp/bw-jl/` (not committed).

# xStock reopen gaps and LP returns, measured 4 October 2026

Our own measurement, testing whether the Sunday 20:00 ET and Monday 09:30 ET
reopenings cost xStock AMM liquidity providers enough to justify an on-chain
opening auction. Covers the deepest USDC pool for SPYx, NVDAx, TSLAx and GOOGLx
over eight weekends (10 August to 28 September 2026). Context:
[pivot options](2026-10-04-pivot-options.md).

## Verdict

The reopen jump is real but small. Pools track Hyperliquid's weekend equity perps
(HIP-3 `xyz:` markets), so most of a weekend move is priced before the reopen.
The deepest 10–25 bp pools earned more in fees than they lost to arbitrage.
**An opening auction or LP-protection product does not address a material loss on
Solana today**, and neither does a weekend liquidation backstop: the same tracking
keeps reopen jumps inside the liquidator's bonus.

## Results

- **Weekend tracking:** median |pool − Hyperliquid perp| was 0.19% (pool-weekend
  medians 9–117 bps), consistent with Datum's 17–124 bps over 21 weekends.
- **Reopen gaps:** median 0.30%, maximum 1.35% (GOOGLx, 21 September); 12% of
  60 events exceeded 0.5%. Convergence usually took 1–6 minutes, up to about 14
  on Mondays; GOOGLx sometimes did not converge within 60 minutes on Sunday.
- **LP loss at reopenings:** about $190–$890 per weekend across all four pools,
  both reopenings included. A theoretical cross-check gave $103–$904.
- **Example:** NVDA fell 3.26% from Friday close to Monday open on 14 September;
  the pool had already moved −1.50% by Sunday 20:00, leaving a 0.4% gap.

| Pool (fee)                   | 30-day volume | LP fees | Arbitrage loss (LVR) range |
| ---------------------------- | ------------- | ------- | -------------------------- |
| SPYx Raydium 6truu3 (10 bp)  | $114.7M       | $96k    | $0.3k–$37k                 |
| SPYx 4pCZ (1 bp)             | $165.3M       | $14k    | $0.4k–$6.5k                |
| NVDAx Raydium 49iMat (10 bp) | $118.4M       | $99k    | $3.0k–$39k                 |
| NVDAx Orca 6R4r (2 bp)       | $64.0M        | $11k    | $0.1k–$61k                 |
| TSLAx Raydium 8aDa (10 bp)   | $32.4M        | $27k    | $6.3k–$25k                 |
| GOOGLx B8YA (25 bp)          | $16.0M        | $34k    | $2.8k–$23k                 |

Period 2 September to 2 October, excluding xPoints rewards. Reopen losses are
under 1% of monthly fees.

## Method

- Pool prices: GeckoTerminal one-minute OHLCV. Sunday reference: Hyperliquid
  `xyz:` perps 15 minutes after 20:00 ET. Monday reference: Yahoo 09:30 ET bar.
  Calibration: median pool/reference ratio, Monday 10:00–10:30 ET (absorbs the
  xStock multiplier and perp basis). Pyth historical endpoints returned 401/404.
- Reopen loss: per minute until convergence, swap volume × |mispricing| / 2.
- Fees: GeckoTerminal daily volume × LP share of the fee (Raydium 84%, Orca 87%).
  LVR: 30-day realised variance of 15-minute perp returns / 4 × L·√P, using
  on-chain active liquidity (upper) and a volume-derived depth ceiling (lower).

## Limits

- Gaps under about 0.2% (0.4% for GOOGLx) are within fee noise.
- The Hyperliquid perp stands in for the overnight price and can itself be off.
- Liquidity is one snapshot (3 October) applied to 30 days; the two LVR estimates
  differ by 10–600×.
- Volume rose after 14 September (Kraken vault launch) and may include incentive
  or wash volume. P&L against holding was not computed.
- Eight weekends, none with a large tracking failure. Loss scales with the square
  of the gap: a weekend where a pool missed a 5% move would cost about $17k on
  NVDAx alone. AAPLx, QQQx, MSTRx, HOODx and CRCLx were not covered.

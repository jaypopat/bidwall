# Is there a real need for Bidwall? Market validation, 4 October 2026

Synthesis of our own on-chain measurements and three sourced research memos:
[Kamino and xStocks risk](2026-10-04-kamino-xstocks-risk.md),
[competitive landscape](2026-10-04-competitive-landscape.md) and
[buyers and go-to-market](2026-10-04-buyers-and-gtm.md). Claims from outside
sources carry citations in those memos; numbers marked "measured" are ours.

## Verdict

The broad idea (pre-funded buyers for liquidations) is an established category,
and for the large, liquid xStocks (SPYx, QQQx, NVDAx) the exit problem is
largely handled today. A narrower, real need remains:

1. **Single-stock collateral with thin exits, concentrated in a few loans, whose
   liquidation path has never been exercised at size.** On Kamino today that is
   GOOGLx.
2. **Lenders are already improvising private fixes for exactly this.** Venus
   funded a $200k treasury buffer and a dedicated backstop liquidator for its
   tokenized stocks; Flowdesk handles liquidations itself for the xStocks vault it
   curates on Morpho; Aave's new equities hub assumes liquidators clear positions
   within five minutes of the Monday open.

Bidwall's defensible position is the **open, escrowed, multi-provider version of
those private arrangements**: committed exit capacity a risk manager can read on
chain ("$X covered at price P until date T") and set caps against.

## What we measured (Kamino public xStocks market)

- **Loan book** (slot 453086228, 3 Oct 23:50 UTC): $5.33M USDC debt across 1,695
  loans; top 10 loans hold 40% of debt. $1.05M of debt is within a 20% uniform
  price drop of liquidation; $2.47M within 30%.
- **Liquidation history:** 60,000 market transactions over 45 days (20 August to 4 October) contained two
  liquidations, of $0.10 and $0.33. Kamino reports $0 bad debt. The liquidation
  route has not been tested at size.
- **Exit depth** (Jupiter quotes, Saturday): $1M sells quote −0.1% SPYx,
  −0.9% NVDAx, −16% MSTRx, −18% to −22% QQQx, −36% TSLAx, −58% GOOGLx, −77% AAPLx;
  HOODx has no route at $1M.
- **Single-name shock, collateral that becomes liquidatable** versus what the DEX
  absorbs within the liquidator's net 2.5% bonus (Kamino takes 50% of the 5%
  minimum bonus):

  | Asset      | −10%                | −20%           | −30%           | DEX absorbs within 2.5% |
  | ---------- | ------------------- | -------------- | -------------- | ----------------------- |
  | **GOOGLx** | **$177k (2 loans)** | **$630k (12)** | **$747k (27)** | **~$147k**              |
  | TSLAx      | –                   | $38k           | $161k          | ~$248k                  |
  | SPYx       | $2k                 | $69k           | $584k          | ~$703k+                 |
  | QQQx       | $1k                 | $62k           | $73k           | ~$220k                  |
  | Others     | –                   | ≤$73k          | ≤$90k          | ≥$74k                   |

  Under a market-wide −30% move, GOOGLx ($957k), TSLAx ($586k) and AAPLx ($147k)
  all exceed their absorbable depth.

- **Parameter mismatch:** GOOGLx carries a 60% LTV (70% liquidation threshold)
  with the thinnest exit in the market, while MSTRx, with deeper exit depth, is
  capped at 30%. Kamino publishes no rationale for either.

Limits: quotes are indications at one moment; depth refills over time; repeated
liquidations are approximated by "whole position at stake"; xChange (issuer RFQ)
and Kraken Pro 24/7 books are routes our Jupiter quotes do not include.

## How the risk actually arrives

Kamino prices xStocks with Chainlink equity streams, which stop publishing from
Friday 20:00 to Sunday 20:00 ET. A weekend move therefore cannot liquidate anyone
until the overnight session reopens at **Sunday 20:00 ET**, when the price jumps
in one step. Kamino has no liquidation auction (fixed bonus formula), the net
bonus after its 50% protocol fee is about 2.5–5%, and the issuer's redemption
route is permissioned and quotes extended-hours spreads at that moment. That
reopening is Bidwall's moment of need.

## Already solved, so not the pitch

- "A backstop pool for liquidations": Liquity stability pools, B.Protocol,
  Hyperliquid HLP, Drift insurance fund, Ajna's price buckets.
- Liquidation value recapture (Chainlink SVR, OEV auctions).
- Instant exits for tokenized treasuries and credit (issuer redemption facilities).
- Borrower-side protection for the weekend gap (Holdline and others at Colosseum).
- Exit liquidity for SPYx, QQQx and NVDAx at today's loan sizes.

## Unoccupied angle

| Existing approach                                | Why it is not the same                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Stability or backstop pools                      | Priced off the oracle, withdrawable; capacity is not a fixed promise                                 |
| Issuer RFQ (xChange)                             | Permissioned, ~60-second quotes, 24/5                                                                |
| Private MM arrangements (Flowdesk, Venus buffer) | Opaque, single provider, treasury-funded                                                             |
| **Bidwall**                                      | **Escrowed, fixed price, fixed term, non-cancellable, inspectable on chain, open to many providers** |

## Who pays, and how to sell it

- **Design partners to approach first:** Sentora (curates the Kraken xStocks
  vaults on Kamino and owns liquidation-threshold risk), Kamino's risk partner
  Allez Labs, Jupiter Lend (runs higher xStock thresholds), Venus (already budgets
  for a backstop), and LlamaRisk or TokenLogic for Aave's equities hubs.
- **Capital providers:** market makers already doing this privately (Flowdesk).
- **Pricing:** the bid is an out-of-the-money put. A yearly reservation fee on
  committed capacity, tiered by volatility (illustratively 2–4% for index tokens,
  8–15% for single stocks), paid by the curator or protocol out of the extra
  lending a higher cap allows; issuers can co-fund.
- **Pitch line:** _"Every lender adding tokenized stocks is improvising the same
  fix in private. Bidwall makes the buyer public, funded and checkable."_

## Honest weaknesses

- Kamino's xStocks debt is small ($5.3M public, about $1.7M in the Sentora market)
  and has been flat since April, capped by USDC supply. The fee pool is small
  today; the bet is on the category's growth (Solana tokenized-equity supply rose
  47% in three weeks to $684M; Aave launched equities hubs in September).
- Kraken owns the issuer, 24/7 order books and the vault channel, and could
  backstop its own products.
- Providers will demand discounts deeper than the liquidator's 2.5–5% unless a
  reservation fee exists; without a payer the coverage is worthless.
- Colosseum already backed an RWA liquidation marketplace (ODL), and Holdline
  targets the same weekend window from the borrower side.

## What this changes

1. **Lead with GOOGLx, not NVDAx.** NVDAx now exits $1M at under 1%.
2. **Frame the moment as the Sunday 20:00 ET reopening**, not "the weekend".
3. **Position as committed, inspectable capacity** that lets risk managers set caps,
   citing Venus, Flowdesk and Aave as evidence the need is recognised.
4. **Use the risk monitor as the entry point:** it measured the gap no one
   publishes.

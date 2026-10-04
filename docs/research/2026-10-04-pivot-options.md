# Pivot or stay? Options review, 4 October 2026

Follow-up to [market validation](2026-10-04-market-validation.md). Four research
passes: unsolved tokenized-stock pain points, Colosseum judging and prior art,
pivot candidates that reuse our code, and who is paying or asking. Sources are
URL plus date; unverified items are marked.

## Verdict

Do not pivot away from the problem; pivot the product. The pain we measured is
real and widely recognised, but escrowed bids alone are too narrow (Kamino-only,
about $5M of debt) and sit next to ODL, a Frontier winner. The unoccupied
position is **liquidation capacity as a public number**: per tokenized stock, how
much collateral can actually be sold at liquidation size, right now and at the
Sunday 20:00 ET reopen, so lenders can set caps they can defend. Bidwall's
committed bids become the supply side: market makers add funded capacity that
raises that number.

## The unsolved pain, with evidence

Lenders are listing tokenized stocks with caps and LTVs they cannot justify,
because no one publishes sellable depth at liquidation size.

- **Aave Base Equities Hub** (live 2026-09-25, about $29M collateral, $21M
  borrow cap): LlamaRisk's assessment says liquidators cannot redeem, the issuer
  has no market maker, and depth is $0.27M–$1.08M per token at 2% impact. The
  model assumes liquidations clear within 5 minutes of the reopen.
  https://governance.aave.com/t/coinbase-b20-equities-on-base-assessments/25690
- **Aave governance is arguing about exactly this, three times in ten days:**
  an X Layer framework sizing caps to "measured sellable depth" (a $100k fork
  replay filled only about $58k, 2026-09-28), and a critique of the Monad V4
  equities proposal for having no depth at liquidation size (2026-10-02).
  https://governance.aave.com/t/discussion-a-risk-framework-for-tokenized-equities-on-aave-v3-x-layer-with-wtcentx-as-the-worked-example/25724 ,
  https://governance.aave.com/t/arfc-deploy-aave-v4-on-the-monad-network/25722
- **Monad V4 equities hub** (TokenLogic, 2026-09-28): $15M incentive budget,
  collateral factors from the 99th-percentile weekend gap, no exit-depth analysis.
- **Venus** listed bStocks with borrow caps of 0 because liquidation behaviour is
  "still to be proven". https://cryptoslate.com/tokenized-stocks-defi-collateral-venus/
- **Kamino** (measured): GOOGLx at 60% LTV with $630k liquidatable after a 20%
  drop against about $147k absorbable within the liquidator's net bonus; MSTRx,
  with deeper exits, is capped at 30%.
- **Money already flows here:** Aave pays LlamaRisk $3.5M a year, with "a
  liquidator spoke for RWAs" in scope (2026-04/05). Kraken pays to make xStocks
  usable in DeFi (xPoints; Sentora-run vaults on Kamino since 2026-09-14).

Tokenized stocks in DeFi grew from $14.7M in January to $262M (Token Terminal via
Cryptopolitan, late September 2026); 26% of that is in lending.

## What already exists, and the gap

| Who                                  | What it does                                                        | Gap                                                            |
| ------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| Kamino KRAF dashboard (Allez Labs)   | Price impact by size; liquidations under shocks, as separate panels | Not joined; no weekend or reopen view; Kamino only             |
| LlamaRisk, TokenLogic, forum authors | One-off reports and fork replays per listing                        | Manual, point-in-time, not machine-readable                    |
| Pyth Indices, RedStone Live, HIP-3   | 24/7 reference prices                                               | Price, not depth; lenders deliberately freeze prices off-hours |
| Venus buffer, Flowdesk on Morpho     | Private backstop capacity                                           | Opaque; does not show up in anyone's cap model                 |

Nobody publishes, continuously and across lenders, **liquidatable collateral
versus absorbable depth per asset, including committed capacity**. That is our
risk monitor plus Bidwall.

## Candidates considered and rejected

- **Weekend reference price oracle.** Shipped by Pyth Indices (2026-06) and
  RedStone Live; lenders prefer frozen prices.
- **Solana OEV or liquidation auction.** Pyth wound down Express Relay on
  2026-07-22 at under $2k a month of revenue.
- **Pre-liquidation for Solana.** Kamino partial liquidation (0.1% minimum
  penalty, 10% steps) and Jupiter Lend already deliver it.
- **Corporate-action multipliers, halt sync, issuer-risk scores, borrower
  weekend shields.** Each has several Stocklana entries (604 submissions).
- **Session-aware AMM to protect LPs off-hours.** The biggest money ($5.77B a
  quarter on Raydium, about 71% off-session), but LP losses are unquantified,
  we have no AMM code, and Jump's PropAMM competes. Best fresh-start option, wrong
  for eight days.
- **Issuer-agnostic "same stock" layer** (NVDAx, NVDAon, Backpack NVDA as one
  collateral). Open, but Jupiter or Ondo can ship it, and it does not use our work.

## Fit with Colosseum

Criteria: functionality, impact (TAM), novelty, UX, open source, business plan;
the pitch video is watched first. Colosseum warns against "overly narrow scopes".
Superteam's 2026 DeFi ideas list names an open clearing and liquidation layer
(#7). Framing as cross-lender liquidation capacity answers the scope warning; a
Kamino-only bid tool does not. Robinhood Chain has its own $25k track (dual
eligibility unverified).

## Recommended product and six-day build

**Pitch:** _"Lenders are listing tokenized stocks with caps nobody can defend:
Venus set borrow caps to zero, Aave assumes a five-minute clearing, Kamino lends
60% against GOOGLx with a $147k exit. Bidwall publishes how much of each stock
can actually be liquidated, at the Sunday reopen, and lets market makers post
funded capacity that raises it."_

1. Generalise the monitor into a per-asset liquidation-capacity figure (DEX depth
   within net bonus plus committed Bidwall bids) and a depth-safe cap or LTV.
2. Add a second lender (Jupiter Lend xStocks) to prove cross-lender coverage.
3. Publish the figure on chain in a capacity account a lender can read, and show
   a Bidwall commitment raising it in the local demo.
4. Reopen forecast page and Friday-close / Sunday-reopen alert.
5. Backtest on the last 45 days of weekends; demo and videos on 11–12 October.

**Demand validation to collect:** short messages to LlamaRisk, TokenLogic,
Allez Labs, Sentora, Venus and Jupiter Lend, leading with the GOOGLx and Aave
numbers.

**Open risks:** willingness to pay is unproven; Allez could add the joined view
to KRAF; the forum posts above must be checked for independence before being
cited.

## Update after our own measurement (later on 4 October)

[Reopen-gap measurement](2026-10-04-reopen-gap-measurement.md): pools track
Hyperliquid weekend perps (median 0.19% apart); reopen gaps median 0.30%; LPs lost
$190–$890 per weekend at reopenings across four pools and earned more in fees
than they lost to arbitrage. This rules out three further candidates:

- **Opening auction or session-aware LP protection.** Loss is small, and
  prototypes already exist (Uncross call auction on Solana devnet, Credence
  opening liquidation auction, MarketClock, GapGuard live on Robinhood Chain).
- **Weekend liquidation backstop as the headline.** Reopen gaps sit inside the
  liquidator's bonus, and Kamino's 20% close factor keeps first-step releases
  within depth.
- **Hedged xStock LP vault** (USDC in, LP plus Hyperliquid short). Marginal: about
  15–30% net while the post-6-September volume regime lasts, roughly 3–5% if
  volume reverts, capacity of about $2–5M, and a cross-chain hedge. Kamino
  Liquidity has no xStock strategy yet, so it is a feature for them rather than
  a company for us.

**Decision:** keep Bidwall as the base and pitch it on evidence. Tokenized-stock
lending is safe on Solana today because of two things we measured, partial
liquidation and weekend perp tracking, and neither is guaranteed as lenders scale
(Aave hubs, Venus, Monad). Bidwall measures how much of each stock's loan book is
actually liquidatable and lets market makers commit capacity that raises it.
GOOGLx is the worked example: 60% LTV, $0.79M pool, slowest convergence.

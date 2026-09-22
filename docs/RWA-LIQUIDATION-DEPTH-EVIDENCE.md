# Backstop — evidence appendix

Measurements and their limits · 20 September 2026

> **This is not the product brief.** The brief is [`RWA-LIQUIDATION-DEPTH.md`](RWA-LIQUIDATION-DEPTH.md);
> the critique that reshaped it is [`RWA-LIQUIDATION-DEPTH-REVIEW.md`](RWA-LIQUIDATION-DEPTH-REVIEW.md).
> This file exists to carry raw numbers, verified mint addresses, the full weekend-gap distribution
> and hedge-venue observations, together with every known weakness in how they were collected.
>
> Where this file and the brief disagree on framing, **the brief wins**. Nothing here is validated:
> no market maker, lender or risk curator has been interviewed, and no claim of a 3% bid, sub-1%
> hedge cost or improved borrowing capacity has been established.

---

## 1. One sentence

**Lending markets can price tokenized stock collateral but may not be able to sell it during the ~80%
of its life when the underlying market is shut — Backstop lets market makers sell funded, term-bound,
non-cancellable liquidation bids that lenders and liquidators can rely on.**

---

## 2. The problem, measured

Tokenized equities are live collateral on Solana today. [Kraken's xStocks Vaults borrow against
tokenized equities routed through Kamino](https://thedefiant.io/news/defi/kraken-launches-xstocks-vaults-that-borrow-against-tokenized-equities). Reported figures put Kamino at the centre of
Solana tokenized-stock lending, but **the public numbers do not reconcile**: one headline claims
[82.6% share](https://www.kucoin.com/news/flash/kamino-lend-controls-82-6-of-tokenized-stock-lending-on-solana) while the same article's "$31M of $53M" implies 58.5%. These likely measure
different things (deposits vs outstanding debt) at different dates. **Reconcile before quoting either.**

NASDAQ and NYSE trade ~32.5 hours out of 168. This collateral spends ~80% of its life with its
underlying market shut.

### 2.1 Pricing is solved. Depth may not be.

- [Pyth EquityMark publishes `Equity.US.TICKER/USD` on Solana with `marketSession` and `afterHours` flags](https://docs.pyth.network/price-feeds/core/price-feeds).
- [RedStone Live supplies continuous off-hours equity pricing from 24/7 derivatives](https://blog.redstone.finance/2026/03/30/redstone-live-real-time-data-built-for-the-markets-that-never-sleep/).

Knowing the price does not create a buyer. [RedStone's own COO warns about the gap](https://crypto.news/tokenized-stocks-face-24-7-pricing-gap-redstone-coo/).

### 2.2 Indicative quote snapshot — Sunday 2026-09-20, ~20:55 UTC

US markets closed Friday 2026-09-18 20:00 UTC. Jupiter aggregator **quotes** (not executions) for
selling each xStock into USDC, measured against Jupiter's own `usdPrice`.

| notional | NVDAx   | TSLAx   | AAPLx   | METAx   | SPYx   |
| -------- | ------- | ------- | ------- | ------- | ------ |
| $10k     | +0.20%  | +0.01%  | −0.16%  | +0.21%  | +0.62% |
| $100k    | +0.04%  | −0.21%  | −1.13%  | −1.34%  | +0.57% |
| $250k    | −0.39%  | −1.43%  | −3.92%  | −6.82%  | +0.53% |
| $500k    | −2.73%  | −4.49%  | −39.35% | −51.70% | +0.48% |
| $1M      | −33.85% | −42.05% | −69.32% | −76.58% | +0.29% |

| token | mint                                          | pool liq | 24h vol | holders |
| ----- | --------------------------------------------- | -------- | ------- | ------- |
| NVDAx | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | $2.11M   | $4.66M  | 95,256  |
| TSLAx | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` | $1.27M   | $1.86M  | 39,017  |
| SPYx  | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | $8.16M   | $32.1M  | 73,303  |
| AAPLx | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | $0.63M   | $1.21M  | 32,879  |
| METAx | `Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu` | $0.38M   | $1.94M  | 14,117  |

**What this does and does not show.**

It shows a steep single-name impact curve at one instant. It is **not** a demonstrated liquidation
loss. Real liquidations are partial and paced, not one $1M market sale — [Drift's liquidation engine
documents partial liquidation](https://docs.drift.trade/protocol/trading/liquidations/liquidation-engine), and [Kamino Lend V2 describes auction-based
liquidation](https://gov.kamino.finance/t/introducing-kamino-lend-v2/58). **Treat the $1M row as an upper bound, not the expected cost.**

The counter-consideration: splitting a sale only helps if the pool replenishes, and replenishment
depends on arbitrageurs who can hedge into the cash market — the channel that is closed precisely
during these hours. The true cost sits somewhere between the two. **Nobody has measured it. That
measurement is the single most valuable piece of evidence this project could produce.**

Also: pool TVL is not sellable capacity, and one snapshot does not make SPYx categorically safe.

### 2.3 Weekend gap distribution — relevant to pricing the bid

2 years of daily OHLC (Yahoo), 104 Friday-close→Monday-open observations per ticker:

|      | median | p5     | p1     | worst   | covers 95% |
| ---- | ------ | ------ | ------ | ------- | ---------- |
| NVDA | +0.23% | −3.15% | −7.18% | −12.49% | 3.15%      |
| TSLA | +0.08% | −3.90% | −6.50% | −7.60%  | 3.90%      |
| MSTR | +0.60% | −5.60% | −7.38% | −11.40% | 5.60%      |
| AAPL | −0.03% | −1.80% | −2.60% | −5.93%  | 1.80%      |
| SPY  | +0.07% | −1.19% | −2.15% | −3.18%  | 1.19%      |

Unhedged MM profile at a 3% fixed discount: NVDA wins 94.2% of weekends (E +2.89%, worst −9.49%);
TSLA 92.3% (E +3.14%, worst −4.60%); MSTR needs 5%.

`gap.py` models buying at Friday close less a discount and selling at the open. **That matches the v2
fixed-price mechanism** (§3) — it did not match v1's next-open design, which is part of why v1 was wrong.

**Caveats that materially weaken these numbers:**

- **Selection bias.** 104 _unconditional_ weekends is not the distribution of weekends in which
  accounts become liquidatable. The bid is exercised disproportionately in adverse conditions.
- **Buffer ≠ collateral factor.** An account at its liquidation threshold has almost no remaining
  buffer. The relevant comparison is the gap against the margin between threshold and insolvency,
  not against a 40% starting buffer. v1's "conservative LTV already handles gap risk" claim was wrong.
- 2 years, one bull regime, mega-caps only. No 2020-style shock, no single-name fraud or halt.
- Corporate actions and split treatment were not explicitly validated.
- Long weekends (≥3 calendar days) are included.

### 2.4 What we do _not_ have

v1 claimed Venus's "borrow caps of 0" showed a lender disabling the feature. **That was a misreading.**
[A zero borrow cap means the asset is collateral-only — you cannot borrow _that token_; borrowing
_against_ it was enabled at 60/60/50 collateral factors](https://cryptoslate.com/tokenized-stocks-defi-collateral-venus/). This was the strongest demand
signal in v1 and it does not exist. **There is currently no public evidence of a lender blocked by
this problem.** Finding one, or failing to, is the first job.

---

## 3. The mechanism (revised)

A market maker sells a **funded, fixed-price, term-bound, non-cancellable liquidation bid**:

> _"Until Monday 13:30 UTC I will buy up to 4,500 NVDAx at $214.50, for the Kamino NVDAx reserve.
> $965,250 USDC is escrowed and I cannot withdraw it before expiry."_

This is economically **an option the MM writes to eligible liquidations** — that is what is being
priced, and it should be named as such rather than described as a discount.

**Fill flow:** liquidation triggers → adapter proves a valid liquidation against the named market →
escrow pays and collateral is delivered **atomically, at the fixed price** → consumed capacity updates
immediately. Either leg fails, the whole thing rolls back. No funds leave escrow on a promise that
collateral will arrive later.

**Removed from v1:** next-opening-print settlement, the true-up, and the protocol-side hedge. v1
released USDC now but priced at the next open, creating an unfunded receivable — if the open came in
below the provisional mark, nobody was obliged to refund the difference after the debt was repaid.
The mechanism did not close.

Hedging is the MM's own external business, not part of this protocol. Scenario estimates may be
displayed; they must never be labelled executed hedges.

---

## 4. Prior art and differentiation

**Funded liquidation backstops are not new.** [B.Protocol raised $2.2M in 2021 to backstop DeFi
liquidations](https://www.coindesk.com/business/2021/12/22/bprotocol-raises-22m-to-backstop-defi-liquidations); its backstop pools fund liquidations on integrated lending protocols and [the
B.AMM automatically resells seized collateral on a deterministic formula](https://medium.com/b-protocol/b-amm-efficient-automated-market-maker-for-defi-liquidations-fea7b0fdc0c5). v1's claim of an
empty corner was the result of searching for the _mechanism_ ("deferred settlement") rather than the
_category_ ("funded liquidation backstop").

Adjacent Colosseum work: [Kormos](https://colosseum.com/projects/explore/kormos) (`kormos`, Cypherpunk Sep 2025, C4, 2nd DeFi),
[Squeeze](https://colosseum.com/projects/explore/squeeze) (`squeeze`, Radar Sep 2024, 1st DeFi), [Collaterize](https://colosseum.com/projects/explore/collaterize) (`collaterize`, Breakout Apr 2025, DeFi HM),
[Credible Finance](https://colosseum.com/projects/explore/credible-finance) (`credible-finance`, C4). None is an identical product; none proves an empty market.

**Remaining differentiation, stated narrowly:** B.AMM's design is "seize, then automatically resell" —
which assumes a market to resell into. That assumption fails for RWAs during closed hours, where the
buyer must warehouse and hedge off-venue instead. Backstop is therefore a known primitive applied to
the regime where the shipped implementation breaks, plus three specific properties: **asset- and
market-specific allocation, restricted cancellation for a fixed term, and independently inspectable
committed depth.** Remove those and the differentiation largely disappears.

---

## 5. Revenue model

v1 had none. This is the weakest part of the idea.

**The 3% discount is the capital provider's compensation, not our revenue.** Backstop's plausible
revenue is a share of a reservation fee and/or an execution fee — both subject to a buyer existing.

**Reserved capital is expensive.** Illustratively, not a market assumption: $2M reserved for a year
at an 8% hurdle costs $160,000. At a 3% gross spread that requires ~$5.33M of annual fills merely to
clear the hurdle, before losses, hedging, operations and any platform fee. Rare liquidations make
this an **availability-fee business**, not a trading-income business — and it is not obvious who pays
an availability fee.

Further constraints: capacity is consumed once filled; loans can outlive commitments; expiry does not
protect debt already outstanding; and the same escrow cannot back two simultaneous claims.

---

## 6. What gets built

One asset, one debt token, one lender adapter, one fixed commitment window.

- **Commitment program** — verified mint, named market/adapter, fixed unit price, max quantity,
  remaining USDC, start, expiry. Maximum consideration funded upfront.
- **Liquidation adapter** — proves a valid liquidation against the target protocol; settles delivery
  and payment atomically; rolls back on either leg failing.
- **Depth view** — publishes "USDC committed at these prices, for this market, until this time."
  **Not** a "safe borrow cap" — that requires a lender-approved risk model covering maturity,
  concurrent liquidations, oracle failure and depletion.

Guards: no premature withdrawal, no overfill, no wrong-asset settlement, no replay, no double
allocation, no unauthorised liquidation calls.

Build dependency to confirm first: the review reports Kamino's xStocks market uses **Chainlink**, not
Pyth. I could not verify this (JS-rendered page). **If true, the Pyth `marketSession` trigger in v1 is
wrong for that market.** Check before writing code.

---

## 7. The demo

**① Liquidation Reality** — live, per asset: oracle price beside quoted proceeds at $100k / $500k /
$1M, labelled as an indicative quote snapshot. `depth.py` already produces this; it needs a UI.

**② Commitment Book** — funded bids per asset with price, size, expiry and remaining capacity.

**③ Liquidation Run** — a real liquidation settled atomically against a funded bid, plus the
exhausted-capacity case. Baseline comparison must use a realistic paced liquidation path, not a
single $1M market sale, or it only proves that subsidised capital improves outcomes.

**④ Expiry and uncovered exposure** — what is committed, what expires when, what is uncovered.
_(Replaces v1's "borrow cap calculator", which rested on the Venus misreading.)_

---

## 8. Honest risks

1. **No validated buyer.** The demand signal v1 led with was wrong. Nobody has said they want this.
2. **Known category.** B.Protocol shipped this shape in 2021.
3. **The business may not exist** even if the mechanism works — see §5.
4. **Adoption.** The buyer is a lending protocol with its own risk team. A thin mock lender
   demonstrates mechanics, not integration.
5. **Correlated tails.** Commitments are hit simultaneously in regime events. Full funding bounds the
   payment obligation; it does not create solvency.
6. **Not a consumer product.** The customer is a protocol. This is the third time this shape has come
   round after Warden and the policy engine, both rejected as "not a product."
7. **22 days, solo, first Solana program.** Escrow plus atomic cross-program settlement plus an
   adapter, having never shipped Anchor. Scope must be brutal.

---

## 9. Open questions — in priority order

1. **Would a market maker quote a non-cancellable funded bid, and at what price?** Seek an indicative
   term sheet: asset, price rule, size, duration, fee, cancellation, eligibility. A friendly
   "interesting" is not validation. **This gates everything else.**
2. Is there a lender or risk curator who would pay for, or integrate, reserved capacity?
3. What does a realistic paced liquidation of $1M of NVDAx actually cost during closed hours?
4. Chainlink or Pyth for the target market?
5. Do the economics survive for mid-caps, where depth is thinner and gaps wider?

---

## 10. Sources and reproduction

Measured 2026-09-20: Jupiter aggregator quote and token APIs; Hyperliquid `info` API (`perpDexs`,
`metaAndAssetCtxs`, `l2Book`); Yahoo Finance daily OHLC (2y). Scripts at
`research/2026-09-20-rwa-liquidation/{gap.py,depth.py}`.

**Known measurement weaknesses:** quotes not executions; `slippageBps=9999` gives no minimum-output
protection if used for execution; baseline is Jupiter's own `usdPrice` rather than an independent
timestamped oracle; mints selected by first exact symbol match rather than issuer verification; raw
routes, quote slots and precise timestamps are not preserved. Fix these before publishing any number.

**Hedge-venue context (v1 §4, retained but downgraded):** HIP-3 via TradeXYZ showed 123 markets,
$3.82B OI and $482M 24h volume on a Sunday, with tight basis to spot (NVDA +0.09%, AAPL −0.33%,
META +0.18%). But visible book depth within 25bp was small — NVDA $272k, AAPL $77k, META $32k. **The
v1 claim of a 10–30x spread and a sub-1% hedge cost is withdrawn as unvalidated.**

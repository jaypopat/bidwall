# Backstop — commitment review

As of 20 September 2026. Review of `RWA-LIQUIDATION-DEPTH.md`, its measurement scripts, primary protocol documentation, and Colosseum Copilot project/archive results. This is a mechanism and product assessment, not confirmation of live execution or buyer demand. No market maker or lender was interviewed for this review.

**Recommendation: choose a narrowed Backstop prototype over the broad AI strategy workspace, but do not build or pitch the mechanism as currently written.** The strongest idea is a funded, liquidation-only bid that cannot disappear during its agreed term. The weakest parts are next-opening-price settlement, the claimed economics, and automatic translation of escrow into safe borrowing capacity.

The prototype has a credible technical story. The business remains unvalidated. Give commercial validation the first two days alongside a small technical spike; do not spend three weeks polishing an assumed 3% bid.

## What is worth preserving

- The distinction between collateral valuation and available buyers is useful and explainable. A reliable mark does not ensure a large liquidation can settle near that mark.
- The workflow has identifiable users: liquidation operators, market makers and lending-market risk curators. A curator could purchase reserved capacity; an operator could consume it. Those are different roles and should be tested separately.
- Tokenized-equity lending is an actual use case. Kamino's September 14 announcement describes SPYx, QQQx and NVDAx collateral backing stablecoin borrowing through Veda/Sentora vaults. It also identifies Chainlink as the oracle provider for that market. An integration cannot assume the lender uses the proposed Pyth trigger. [Kamino announcement](https://kamino.com/blog/xstocks-vaults-launch-on-kraken-powered-by-kamino)
- On-chain escrow has a purpose here: enforcing payment and preventing withdrawal of committed funds. No TEE or AI decision maker is required for that core obligation.
- This better matches a Rust builder's technical strengths than another natural-language strategy interface. It also better matches access to protocol developers, although access to developers is not yet access to a market maker's balance sheet.

## Five corrections before committing

### 1. The settlement cash flows do not close

The proposal releases USDC now to repay debt, but determines the purchase price at the next official opening print. Those cannot be treated as a single fully settled transaction.

Illustration: 1,000 units are provisionally valued at $100 each. A 3% discount releases $97,000. The next opening price is $80, making the final purchase consideration $77,600. Who returns the $19,400 difference after the debt has been repaid? If the opener is $120, who supplies the extra $19,400? A USDC budget and maximum quantity must also prevent aggregate fills exceeding escrow.

Upfront MM escrow does not solve the downside refund obligation. You need a separate advance/credit arrangement, retained collateral, a funded loss reserve, or a purchase price settled immediately. Each changes the product.

The gap backtest also evaluates a different trade: `gap.py` explicitly models buying at **Friday close less a discount**, then selling at the open. The proposed contract buys at **the opening price less a discount**. Its historical P&L table does not validate its mechanism.

The suggested full-size short is inconsistent with the floating purchase price too. Under the simplifying assumption that token and perp converge to opening price O, q tokens bought at (1−d)O have gross value less purchase cost of qdO. Adding a short of q opened at H gives q[H−(1−d)O], not a locked discount. Real token/perp basis makes this more complicated still.

**Change:** settle a funded bid atomically at a known price. Remove the official-opening true-up from the prototype.

### 2. The Venus argument conflates borrowing a token with borrowing against it

The listing proposal sets stock-token borrow caps to zero while specifying positive collateral factors. Venus documents borrow caps as limits on borrowing the underlying asset of that particular market. That alone does not establish that stablecoin borrowing against stock collateral is disabled. Other settings may constrain that activity, but they must be checked separately. [Venus listing](https://community.venus.io/t/bnb-chain-list-vtslab-vnvdab-and-vspcxb-markets-in-the-venus-core-pool/5832), [borrow-cap semantics](https://docs-v4.venus.io/technical-reference/reference-core-pool/comptroller/diamond/facets/setter-facet)

Remove “Venus allows 0; Backstop safely allows X.” This is a central piece of the demand argument, not a cosmetic citation fix.

Also, $31M / $53M is approximately 58.5%, not 82.6%. Reconcile dates, denominators and whether the figures describe supplied collateral, outstanding debt, or a different market before using them.

### 3. The depth experiment is a promising signal, not demonstrated liquidation loss

Inspection of `research/2026-09-20-rwa-liquidation/depth.py` shows:

- It obtains quotes; it does not build, simulate or execute the swaps.
- The headline percentages compare output against Jupiter token-API `usdPrice`, not an independently timestamped lender oracle. They are not simply the API's `priceImpactPct`.
- It requests `slippageBps=9999`, a 99.99% execution tolerance. This does not itself make `outAmount` wrong, but it supplies essentially no minimum-output protection if used for execution. Jupiter distinguishes quoted output from the minimum acceptable output. [Jupiter quote documentation](https://developers.jup.ag/docs/swap/v1/get-quote)
- It selects the first exact symbol match. Production measurement needs issuer-verified mints, token-unit checks and any applicable scaled balance/corporate-action handling.
- Its saved output omits full route responses, quote slots and precise timestamps, making historical reproduction weaker.

The larger issue is the benchmark. A lender need not market-sell the entire $1M position in one transaction. Liquidation size, bonuses, pacing, debt outstanding and other liquidators matter. Kamino has publicly described liquidation auctions; that announcement alone does not establish today's exact implementation or parameters for a particular reserve. [Kamino V2 design](https://gov.kamino.finance/t/introducing-kamino-lend-v2/58)

Copilot's archived **“Liquidation Engine — Drift Protocol”**, dated February 27, 2026, describes partial liquidation and pacing. That supports the conceptual objection to an all-at-once benchmark; it is not evidence of Kamino's parameters. The original URL now redirects, so treat this as archived design evidence. [Original archive source](https://docs.drift.trade/protocol/trading/liquidations/liquidation-engine)

Repeated small quotes against unchanged pool state do not prove that splitting a large sale avoids aggregate impact either. Model state changes and replenishment explicitly.

**Change:** call the table an indicative quote snapshot. Compare actual liquidation-sized lots and a documented stress scenario. Preserve raw observations. Do not call SPYx categorically safe from one snapshot, or equate pool TVL with sellable capacity.

### 4. Gap risk and liquidity risk cannot be separated this cleanly

An unconditional sample of roughly 104 weekends is not the distribution of weekends in which leveraged accounts become liquidatable. The backstop is disproportionately exercised during adverse conditions. A high historical win rate can coexist with negative economics after losses, capital costs and hedge failures.

The script includes trading gaps of three or more calendar days, including long weekends. It does not explicitly normalize corporate actions or validate the historical data's split treatment. These are repairable research issues, but the resulting statistics cannot justify “conservative LTV already handles gap risk.” Starting collateral factor is not the remaining buffer of an account already near liquidation.

Similarly, open interest, daily volume and tight spreads do not establish a $1M short can be opened cheaply under stress. The brief's own visible-depth figures are much smaller than its contemplated fills. A limited order-book response means uncertainty beyond the returned levels, not evidence that the missing depth exists at the desired price.

**Change:** delete the 10–30x profit-spread claim. Jointly stress token price, executable spot depth, hedge entry, basis, funding, margin and commitment depletion. Treat the below-1% hedge cost as an unvalidated hypothesis.

### 5. Reserved capital is the product's cost, not free infrastructure

The important commercial question is: **what price will a real MM quote to remain unable to cancel precisely when the trade becomes unattractive?**

Illustration, not a current market yield assumption: reserving $2M for a year at an 8% capital hurdle costs $160,000. A 3% gross spread requires about $5.33M of annual fills just to cover that hurdle, before losses, hedges, operations and platform fees. Rare liquidations create an availability-fee business; they do not automatically create attractive trading income.

The 3% discount belongs primarily to the risk-taking capital provider. It is not Backstop revenue. A plausible revenue model is a share of a reservation fee and/or execution fee, subject to buyer willingness to pay.

Full funding assures a bounded payment obligation, not unlimited solvency. Capacity is consumed after a fill. Existing loans may outlive commitments. Stopping new borrows when commitments expire does not protect outstanding debt. The same escrow cannot be counted as dedicated capacity for multiple simultaneous claims.

## Competition and differentiation

The generic concept is established. B.Protocol documents funded backstop participation and an AMM designed for liquidations. Its existence is useful precedent for the mechanism and a reason not to claim that funded liquidation liquidity is new. [B.Protocol overview](https://docs.bprotocol.org/info/general), [B.AMM design](https://docs.bprotocol.org/technical-documentation/v2)

Targeted Colosseum Copilot searches included both accelerator-only and winner-only filters:

- [Kormos](https://colosseum.com/projects/explore/kormos), `kormos`, Cypherpunk September 2025, C4, second-place DeFi: adjacent work on liquid/locked capital and the liquidity-yield tradeoff, not evidence of an identical backstop.
- [Credible Finance](https://colosseum.com/projects/explore/credible-finance), `credible-finance`, Renaissance March 2024, C4: adjacent RWA-backed credit.
- [Squeeze](https://colosseum.com/projects/explore/squeeze), `squeeze`, Radar September 2024, first-place DeFi: adjacent leverage and liquidation design.
- [Collaterize](https://colosseum.com/projects/explore/collaterize), `collaterize`, Breakout April 2025, DeFi honorable mention: adjacent RWA liquidity.

Search relevance was mixed. These results neither establish an exact competitor nor prove an empty market. They also do not provide a defensible probability of winning.

Your potential differentiation is **asset-specific, term-bound liquidation capacity that can be independently inspected and consumed by an existing liquidation workflow**. Against ordinary funded limit orders, explain conditional liquidation access, restricted cancellation, allocation to a named market, and payment for keeping the bid available. If you remove those constraints, the differentiation shrinks considerably.

## The version I would build

Pitch: **“Reserve buyers for tokenized-stock liquidations before the market needs them.”**

Start with one asset, one debt token, one lender adapter and one fixed commitment window. Prefer NVDAx only after confirming the relevant lender reserve and token mechanics. The sharp demo is a buyer who cannot withdraw an active commitment and whose escrow really settles an eligible liquidation.

One program should hold a bid's verified mint, named market/adapter, fixed unit price, maximum quantity, remaining USDC, start time and expiry. Fund maximum consideration upfront. A fixed price is economically an option granted to eligible liquidations: acknowledge that and price the reservation. Do not assume an MM offers a full weekend at 3% below Friday close.

The adapter must prove a valid liquidation and settle collateral delivery with payment atomically. An illustrative transaction spends $9,700 from escrow for 100 units at a $97 firm bid, directing proceeds through the liquidation operation to repay the required debt. The lender's rules determine repay amount, seized quantity and residuals; if these cannot fit the bid, it cannot be filled. Test atomic rollback if either leg fails. Funds must never leave escrow on an unsupported claim that collateral will arrive later.

Prevent premature withdrawal, overfill, wrong-asset settlement, replay and double allocation. Reject unauthorized liquidation calls. Show consumed capacity immediately. Keep unused escrow withdrawable only under the agreed expiry rules. Show uncovered exposure and commitment expiry explicitly.

This can potentially be used by an existing liquidator without a protocol-wide routing change; establish that against the chosen protocol interface. Getting a lender to recognize it in risk limits is a separate adoption step. A thin mock lender demonstrates mechanics, not production integration.

Hedging is initially the MM's external operation. Display scenario estimates if useful, but do not label them executed hedges. No official-opening settlement, multi-chain execution engine, AI strategy generator or four-program architecture in this build.

The depth display should report “USDC committed at these prices, for this market, until this time.” Do not output “safe borrow cap” without a lender-approved risk model that includes maturity, concurrent liquidations, oracle failures and depleted capacity.

## The demo and three-week plan

- **Days 1–2:** repair the quote evidence, confirm one lender's actual liquidation interface, and obtain concrete feedback from one liquidation/MM operator and one curator or lending-risk person. Seek an indicative term sheet: asset, price rule, size, duration, fee, cancellation and eligibility. A friendly “interesting” is not validation.
- **Days 3–8:** implement and test the funded commitment lifecycle and atomic settlement with a minimal lender harness. Include depletion, expiry and adversarial cases. Avoid UI polish until the money flow works.
- **Days 9–14:** build the risk console and pursue an actual protocol adapter or fork-based integration test. Compare identical collateral quantity and market assumptions across the baseline and committed bid. Label mainnet observations, historical replay and test-funded execution separately.
- **Days 15–21:** tighten integration, failure demonstrations and pitch. Show both a successful fill and exhausted capacity. Publish measurement methodology. Get the operator to challenge the demo economics again.

The proposed side-by-side “34% versus 3%” is persuasive only if the 3% bid is plausibly obtainable and the baseline matches a real liquidation path. Otherwise it demonstrates that subsidized capital can improve an outcome, which nobody disputes.

Commercial continuation needs two signals: an operator willing to specify credible funded terms, and a buyer identifying an actual decision those terms improve enough to justify paying or integrating. If neither appears, the smart contract can still be a hackathon experiment, but stop describing the business as validated.

## Final decision

Backstop is more distinctive, technically substantive and aligned with your accessible audience than the broad AI tokenized-stock workspace. It is harder to ship and much harder to validate economically. It is a legitimate infrastructure product if someone buys reserved capacity; a quote dashboard alone would not satisfy that promise.

I would commit the prototype window to the narrower funded-bid mechanism, with the first two days used to challenge its commercial premise. I would not commit to the current next-open settlement, guaranteed 3% economics or safe-borrow-cap story. Its chance of a strong hackathon showing depends on real settlement and credible counterparties, not the size of the headline haircut.

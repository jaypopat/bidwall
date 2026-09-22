# Backstop — reserved buyers for tokenized-stock liquidations

Product brief v2 · 20 September 2026 · Solana hackathon prototype

> Decision: build a focused prototype over 2–3 weeks. Validate capital-provider terms and lender usefulness during the first two days alongside the technical spike. This is not a validated business or a production-ready financial system.
>
> This revision replaces next-opening-price settlement with funded, fixed-price bids and immediate atomic settlement. Detailed reasoning: [commitment review](RWA-LIQUIDATION-DEPTH-REVIEW.md).
>
> Raw measurements, verified mint addresses, the full weekend-gap distribution and hedge-venue observations live in the [evidence appendix](RWA-LIQUIDATION-DEPTH-EVIDENCE.md). This brief summarises them; the appendix carries the numbers and their known weaknesses.

## 1. The product

**Backstop lets lending-market operators reserve funded buyers for eligible tokenized-stock liquidations before those liquidations occur.**

A capital provider escrows USDC against a specific asset, lending market, purchase price, quantity and time window. During that window, it cannot withdraw the committed funds. A valid liquidation can consume the bid through an adapter that exchanges collateral for payment atomically.

The product is a commitment book, settlement program and operator console. Its useful output is inspectable capacity at explicit prices and expiry times. Whether that capacity justifies different lending limits is a separate risk decision.

The first target is one tokenized equity against USDC on Solana. NVDAx is the initial candidate, subject to checking the actual reserve, token mechanics and liquidation interface.

## 2. Customer and reason to exist

Three parties have different jobs:

| Party                                        | Job                                          | Value hypothesis                                                      |
| -------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| Lending-market curator or protocol risk team | Decide whether to purchase reserved capacity | More predictable liquidation proceeds within defined limits           |
| Liquidation operator                         | Execute eligible liquidations                | An additional funded exit route when ordinary routes are unattractive |
| Market maker or specialist capital provider  | Fund bids and manage acquired inventory      | Reservation compensation and potential trading income                 |

The initial buyer hypothesis is a curator or market operator responsible for a specific collateral market. A liquidator may use the route without being the party paying for its availability.

[Kamino’s September 14 announcement](https://kamino.com/blog/xstocks-vaults-launch-on-kraken-powered-by-kamino) describes SPYx, QQQx and NVDAx collateral supporting stablecoin borrowing through Veda/Sentora vaults. This establishes an existing workflow, not demand for Backstop. The announcement identifies Chainlink as the market’s oracle provider; integration must follow the lender’s actual rules.

The hypothesis to validate is precise: **an operator will pay enough for a non-cancellable liquidation bid that a capital provider will supply it at useful terms.**

## 3. Evidence and its limits

### Indicative quote observations

The original research recorded the following Jupiter quote deviations against Jupiter token-API spot prices on Sunday, September 20, 2026. They are retained as exploratory observations, not independently reproduced execution results.

| Input notional | NVDAx   | TSLAx   | AAPLx   | METAx   | SPYx   |
| -------------- | ------- | ------- | ------- | ------- | ------ |
| $100k          | +0.04%  | −0.21%  | −1.13%  | −1.34%  | +0.57% |
| $250k          | −0.39%  | −1.43%  | −3.92%  | −6.82%  | +0.53% |
| $500k          | −2.73%  | −4.49%  | −39.35% | −51.70% | +0.48% |
| $1M            | −33.85% | −42.05% | −69.32% | −76.58% | +0.29% |

This suggests size-dependent exit liquidity merits investigation. It does not establish that an actual lender would lose these amounts or that index collateral is safe. Verified mints, pool liquidity, 24h volume and holder counts: [evidence appendix §2.2](RWA-LIQUIDATION-DEPTH-EVIDENCE.md).

The [measurement script](research/2026-09-20-rwa-liquidation/depth.py) requests quotes rather than simulating or executing transactions. It uses `slippageBps=9999`, selects tokens by symbol and saves summary deviations without complete route responses and timestamps. [Jupiter documentation](https://developers.jup.ag/docs/swap/v1/get-quote) distinguishes quoted output from minimum acceptable execution output.

Before using fresh measurements in the demo:

- Verify issuer mints, decimals and applicable token balance scaling.
- Save raw responses, timestamps, context slots, reference prices and route plans.
- Use bounded slippage and clearly distinguish quotes from successful simulations.
- Measure realistic liquidation lots and compare identical quantities and assumptions.
- Sample different sessions; model pool-state changes when testing sequential sales.
- Check lender close factors, bonuses, pacing and alternative liquidation routes.

[Kamino’s published V2 design](https://gov.kamino.finance/t/introducing-kamino-lend-v2/58) describes liquidation auctions. Verify the selected reserve’s current implementation instead of assuming a whole position must be sold immediately.

### Claims removed from v1

- The inconsistent market-share figures are omitted pending reconciliation of dates and denominators.
- A zero Venus stock-token borrow cap does not by itself prohibit stablecoin borrowing against that token. [Venus cap semantics](https://docs-v4.venus.io/technical-reference/reference-core-pool/comptroller/diamond/facets/setter-facet)
- The [historical gap script](research/2026-09-20-rwa-liquidation/gap.py) is exploratory; its full distribution and caveats are in the [evidence appendix §2.3](RWA-LIQUIDATION-DEPTH-EVIDENCE.md). Its unconditional weekend sample does not establish liquidation-conditioned losses, a safe haircut or profitable bids. Corporate-action treatment needs validation.
- Pricing risk remains. A collateral mark, executable token price and hedge price can diverge.
- No 3% bid, sub-1% hedge cost, 10–30x profit opportunity or increase in safe borrowing capacity has been validated.

## 4. Commitment and settlement

Illustrative bid, not a market-maker quote:

> “For this named lending market, I commit $9,700 to purchase up to 100 units of this verified token at $97 per unit during this specified interval, exclusively through eligible liquidations.”

The maximum purchase consideration is fully funded before activation. Price and quantity use explicit integer units and conservative rounding.

Each commitment records:

- Provider, collateral mint and USDC mint.
- Named lending market and approved liquidation adapter.
- Fixed unit price and maximum collateral quantity.
- Remaining quantity and remaining escrow.
- Start and expiry times.
- Agreed reservation compensation, if any, disclosed separately from purchase capital.

### Transaction flow

1. A keeper identifies a position eligible under the lender’s own liquidation rules.
2. The adapter verifies eligibility and calculates debt repayment, collateral received and fees.
3. It selects an active bid whose terms support that liquidation.
4. In one atomic transaction, escrow funds the required operation and the specified collateral reaches the provider. Any intermediate funding must be resolved inside that transaction.
5. The program reduces remaining capacity and emits a settlement event.
6. If eligibility, delivery, repayment or payment checks fail, the entire transaction reverts.

The implementation must prove the lender-specific cash flow. It cannot release funds merely because a caller promises to deliver collateral later. Borrower residuals and liquidation penalties follow the lender’s rules; Backstop does not automatically change them.

Active commitments cannot be cancelled or repriced by the provider. Unspent funds become withdrawable after expiry. New bids may have different terms. Capacity is allocated once and cannot be presented as independently available to several markets.

There is no next-opening-price true-up, clawback or opening-auction oracle dependency. A fixed bid transfers price risk to the provider; it does not eliminate that risk.

If capacity is exhausted or a bid is insufficient, expose the uncovered amount. An existing liquidation route may still be available, but an AMM fallback is not a guarantee against bad debt.

## 5. Economics to validate

A committed fixed bid grants eligible liquidations an economically valuable option. The provider must price adverse selection, locked capital, inventory risk and operational costs.

Possible compensation consists of a reservation fee paid for availability plus trading income when a bid fills. Backstop could earn a negotiated share of reservation or execution fees. The purchase discount is not automatically platform revenue.

For illustration only: $2M reserved for a year at an 8% capital hurdle costs $160,000. At a 3% gross spread, approximately $5.33M of annual fills would be needed to cover that hurdle before losses and other expenses. Low liquidation frequency may make availability fees essential.

External equity derivatives are a potential inventory-management tool, not guaranteed cheap hedges. Visible spread, volume and open interest do not establish executable hedge depth. Model basis, funding, margin, execution latency and correlated stress. The prototype leaves hedge execution to the provider and labels any modeled hedge as a simulation.

A short commitment can demonstrate settlement but may have little value for long-lived loans. Expiry and non-renewal are material risks: stopping new borrowing does not protect existing debt. This must be addressed before claiming lending-limit benefits.

## 6. Differentiation

Funded liquidation backstops have precedent in [B.Protocol](https://docs.bprotocol.org/technical-documentation/v2). Backstop should not claim to invent the category.

The proposed specialization is a funded bid tied to a tokenized-equity market, an explicit term and verified liquidation access, with restricted cancellation and inspectable remaining capacity.

The first competitor question is practical: why pay for this instead of ordinary liquidators, existing market-maker arrangements or funded limit orders? The answer must come from the value of the commitment and its integration. Without those differences, the product becomes an ordinary order book with narrower distribution.

## 7. Hackathon scope

Build one Anchor program, one keeper/adapter path and a focused web console.

**Required:**

- One asset and USDC, with verified token-unit handling.
- Create, fund, activate, partially fill, exhaust, expire and withdraw a commitment.
- Atomic liquidation settlement against a minimal lender harness.
- Tests for premature withdrawal, unauthorized fills, wrong mints, overfill, replay, expiry boundaries and rollback.
- A quote observer with reproducible metadata and honest execution labels.
- A commitment view showing price, remaining funds, allocated market and expiry.
- A deterministic successful liquidation and a failure/depletion demonstration.

**Target if feasible:** an actual lending-protocol adapter or fork-based integration test. A mock lender is an explicit prototype limitation, not proof of production compatibility.

**Out of scope:** opening-price settlement, autonomous cross-chain hedging, multiple assets, a new lending protocol, AI decision-making, a token launch and a universal safe-borrow-cap calculator.

## 8. Demo

The central moment is verifiable settlement:

1. A provider funds a bid; the console shows its escrow and expiry.
2. An early withdrawal attempt fails.
3. An eligible liquidation consumes the bid, repays the modeled debt and delivers collateral.
4. The console shows transaction evidence and reduced capacity.
5. A second liquidation exceeds remaining capacity; the console exposes the shortfall rather than promising protection.

Alongside this, show indicative external exit quotes for the same quantity. Label mainnet observations, replayed scenarios, test tokens and simulated hedges separately. A self-funded demonstration bid is not evidence that an independent MM will quote those terms.

The pitch is: **“Here is a buyer that cannot disappear during its commitment, and here is the transaction proving it paid.”**

## 9. Build and validation schedule

### Days 1–2: prove the premise and integration path

- Confirm a target reserve, actual liquidation rules and an atomic settlement design.
- Repair quote collection and retain raw observations.
- Seek concrete terms from at least one liquidation operator or MM: price, quantity, duration, reservation fee, eligibility and cancellation restrictions.
- Ask one curator or lending-risk operator which actual decision the commitment improves and whether they would pay or integrate.

A positive signal is an indicative term sheet plus a named operational use case. A general “interesting idea” is insufficient. These conversations are validation tasks, not completed endorsements.

### Days 3–8: working money flow

Implement escrow and the lender harness, lifecycle checks and adversarial settlement tests. Demonstrate partial fills and atomic rollback before polishing the interface.

### Days 9–14: usable prototype

Build the console, reproducible quote comparison and keeper flow. Attempt the real adapter or fork test. Freeze scope if integration threatens the end-to-end demo.

### Days 15–21: evidence and presentation

Complete failure demonstrations, documentation and demo recording. Recheck economics with the operator. Publish exactly what is live, simulated and unvalidated.

## 10. Commitment decision

**Yes: pursue this narrower Backstop prototype for the hackathon.** It offers a clearer technical contribution and more focused customer than the broad AI strategy workspace.

Its strongest submission combines working settlement, honest liquidity evidence and credible operator feedback. It is not yet possible to claim buyer demand, commercially viable commitments or a likely prize.

Use the first two days to challenge the commercial premise while building the technical spike. If useful bid terms and lender interest both fail to materialize, treat continuation as a technical experiment rather than a validated startup. Do not spend the remaining sprint decorating assumed economics.

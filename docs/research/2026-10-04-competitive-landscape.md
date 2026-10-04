# Bidwall: Competitive Landscape Memo

**Date:** 2026-10-04 · **Scope:** committed liquidation liquidity, tokenized-stock/RWA liquidation practice, OEV/intent/RFQ, hackathon prior art
**Convention:** **[F]** = verified fact with source (URL, source date). **[I]** = my inference. Where I could not verify something, I say so.

---

## 1. Summary

- **The "funded backstop pool" idea is old and well covered.** Liquity stability pools, B.Protocol's B.AMM, Hyperliquid's HLP liquidator vault, Drift's insurance fund, Aave Umbrella and Ajna's price-bucket deposits all hold capital ahead of time to absorb liquidations or bad debt. **None of them is a fixed-price, term-locked, per-asset bid that cannot be cancelled.** Each is either priced dynamically (at an oracle price minus a discount), can be withdrawn on short notice, or pays out only after losses occur.
- **Capturing liquidation value is handled at the oracle layer on EVM, but not on Solana right now.** Chainlink SVR has recaptured about $16M for Aave and Chainlink. Pyth Express Relay, which Kamino used to route liquidators, was **wound down in July 2026**. Solana xStocks liquidations are back to open bot races.
- **The tokenized-stock problem is real and documented.** About $111M of tokenized stock sits in DeFi against about $20M of best-case exit liquidity (Aug 2026). **Venus Protocol has a governance proposal for a $200k treasury-funded "bStock liquidation buffer"** to front weekend liquidations, plus a whitelisted "bStock backstop liquidator" (Jun–Jul 2026). That is the clearest sign of demand for what Bidwall does. It is also the clearest competitor pattern: **lenders solve this in-house, with treasury money, through a privileged liquidator.**
- **Hackathon prior art is crowded on the borrower side and thin on the provider side.** Holdline, Aadukalam/Nightguard, StockReef and HaltGate all protect borrowers during closed hours or halt the market. ODL (Colosseum Frontier winner) is an RWA liquidation marketplace, but for private-market secondaries. **I found no project offering committed, fixed-price, term-bound bids from capital providers that settle tokenized-stock liquidations.**
- **Verdict [I]:** The mechanism is a recombination of known pieces, not a new primitive. Three positioning angles look genuinely unoccupied (Section 7). Anything framed as "a backstop pool", "MEV recapture" or "protect borrowers from weekend gaps" is already done.

---

## 2. Comparison table: committed liquidation liquidity

| Mechanism                               | Capital committed ahead?                                                                 | Fixed price?                                                                     | Withdrawable?              | Assets                                  | Status                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Liquity v1 Stability Pool**           | Yes (LUSD)                                                                               | No. Absorbs debt at the oracle price; the gain is the liquidation discount       | Yes, at any time           | ETH                                     | Alive but small: ~7.8M LUSD (Apr 2026) [1]                                                         |
| **Liquity v2 Stability Pools**          | Yes (BOLD), one pool per collateral                                                      | No                                                                               | Yes                        | ETH, LSTs                               | Alive. $160M TVL (Aug 2025) [2]. Feb 2025 SP bug scare caused >$17M outflows [3]                   |
| **B.Protocol B.AMM**                    | Yes (stablecoin LP)                                                                      | No. Uses an AMM curve around the oracle price                                    | Yes                        | Liquity, Hundred, Fantom/Arbitrum forks | Most recent docs are 2021–22. Appears dormant [I] [4]                                              |
| **Maker/Sky Liq 2.0 (Clipper)**         | No                                                                                       | Dutch auction with decaying price                                                | n/a                        | Vault collateral                        | Alive [5]                                                                                          |
| **Aave v3 + Umbrella**                  | Umbrella stakers commit aTokens                                                          | n/a. Covers bad debt, does not buy collateral                                    | Yes, with cooldown         | Aave reserves                           | Live since Jun 2025 [6]                                                                            |
| **Aave Horizon (RWA)**                  | No                                                                                       | Oracle bonus                                                                     | n/a                        | Tokenized funds                         | Live. Whitelisted (KYC) liquidators only [7]                                                       |
| **Compound III absorb + buyCollateral** | Protocol reserves pay up front                                                           | Oracle price × storefront discount                                               | n/a                        | Comet collateral                        | Alive [8]                                                                                          |
| **Euler v2 (EVK)**                      | No                                                                                       | Reverse Dutch: discount grows with how unhealthy the position is                 | n/a                        | Any vault                               | Alive [9]                                                                                          |
| **Morpho Blue + pre-liquidations**      | No                                                                                       | Fixed incentive set by LLTV. Pre-liq parameters set by the borrower              | n/a                        | Isolated markets incl. tokenized stocks | Alive [10][11]                                                                                     |
| **Fluid**                               | No                                                                                       | Tick/branch batch liquidation                                                    | n/a                        | Fluid vaults                            | Alive [12]                                                                                         |
| **Ajna**                                | **Yes. Lenders deposit into price buckets and receive collateral at their bucket price** | **Yes, per bucket**                                                              | Yes (subject to LUP rules) | Any ERC20                               | $775K exploit through bucketTake/take accounting, Aug 28–29 2026. Team told users to exit [13][14] |
| **Gearbox v3**                          | No                                                                                       | Whitelisted partial-liquidation bot                                              | n/a                        | Credit accounts                         | Alive [15]                                                                                         |
| **Spark (SparkLend)**                   | No                                                                                       | Aave-fork bonus                                                                  | n/a                        | Blue chips                              | Alive [16]                                                                                         |
| **Hyperliquid HLP liquidator**          | Yes (HLP vault)                                                                          | Takes over positions at mark price                                               | Yes (vault lockup)         | Perps                                   | Alive. Keeps the trader's maintenance margin [17]                                                  |
| **Drift Insurance Fund**                | Yes                                                                                      | n/a. Covers bankruptcies                                                         | 13-day cooldown            | Solana perps/spot                       | Drift exploited for $286M on 1 Apr 2026. IF reported untouched [18][19]                            |
| **Kamino Lend (v2 / xStocks)**          | No                                                                                       | Bonus = max(min, LTV breach), capped at max. Effectively a Dutch-style escalator | n/a                        | xStocks + crypto                        | Alive. Permissionless liquidators [20]                                                             |
| **MarginFi / Save**                     | No (MarginFi: 2.5% of the penalty goes to an insurance fund)                             | Fixed ~5% / ~8% bonus                                                            | n/a                        | Solana assets                           | Alive [21]                                                                                         |
| **Jupiter Lend vaults**                 | No                                                                                       | Partial sale at threshold                                                        | n/a                        | Incl. xStocks                           | Alive [22]                                                                                         |
| **Jupiter Offerbook**                   | Lender capital per loan                                                                  | **No price liquidation. Lender claims collateral at maturity**                   | Locked for the term        | Any Solana asset incl. xStocks          | Beta [23]                                                                                          |
| **Venus bStock buffer**                 | **Yes. $200k from the treasury, in a multisig**                                          | No. Fronts the liquidation, then sells on a CEX                                  | Discretionary              | bStocks (BNB)                           | Proposal (Jun 2026), subject to legal approval [24][25]                                            |
| **Bidwall (proposed)**                  | Yes                                                                                      | **Yes**                                                                          | **No (term-bound)**        | xStocks on Kamino                       | Hackathon                                                                                          |

---

## 3. How the main precedents work

**Liquity (v1/v2).** [F] Depositors put LUSD/BOLD into the stability pool. When a liquidation happens, their deposit is burned to cancel the debt and they receive the collateral, which nets the liquidation discount [1][2]. Deposits can be withdrawn at any time. That is the main reason stability pools are not a firm commitment. The v2 pool earns borrower interest plus liquidation gains (6–10% APY) [2]. [I] **What limits them:** capital leaves exactly when it is needed. The Feb 2025 v2 scare shows how fast that happens (>$17M left after one warning tweet) [3]. Pools also hold only the protocol's own stablecoin.

**B.Protocol B.AMM.** [F] Stablecoin LPs backstop Liquity and Compound-fork liquidations and resell the seized collateral through an AMM priced off the oracle [4]. [I] It had over $100M at its peak. I found no activity after 2022. It seems to have faded once Liquity and the Compound forks shrank, which shows a backstop is only as viable as the market it is tied to.

**Compound III.** [F] The protocol pays for absorptions out of its own reserves. Collateral is then sold through `buyCollateral` at a storefront discount, and only while reserves are below target [8]. In other words, the protocol is the committed buyer. Bidwall would move that role to outside providers.

**Ajna (the closest mechanical analogue).** [F] Lenders choose a price bucket. "In the worst case scenario, a lender should receive collateral at the price which they lent to the pool". "Deposit take" forces a lender's bucket to buy auctioned collateral at the bucket price [26]. [I] This is very close to Bidwall's fixed-price escrow: a bucket deposit is a standing fixed-price bid. The differences: Ajna's bidders are the lenders themselves, deposits are withdrawable, and the design is oracle-free. Ajna also shows the risk: its v2 was drained of $775K through `bucketTake` accounting in Aug 2026 [14]. Assume judges know this. Expect scrutiny of rounding and residual accounting in Bidwall's split between debt repaid, collateral delivered and surplus returned.

**Hyperliquid HLP / Drift IF / Aave Umbrella.** [F] HLP takes over liquidations the order book cannot absorb, at mark price, and keeps the trader's maintenance margin [17]. Drift IF stakers provide first-loss capital with a 13-day unstake cooldown [19]. Umbrella stakers' aTokens are burned when bad debt appears [6]. [I] All three are protocol-owned pools with discretionary or dynamic pricing. None lets an outside provider say in public: "I will buy X NVDAx at $Y until date Z."

**Morpho pre-liquidations / Euler operators.** [F] Borrowers sign up in advance for tighter, smaller-bonus partial liquidations [10]. On Euler, borrowers can pre-authorize operators with conditional incentives [9]. [I] Borrowers pre-arranging their own exit is a nearby idea. Bidwall pre-arranges the exit from the buyer's side.

---

## 4. Tokenized-stock and RWA liquidation practices

**Kamino xStocks (Solana).** [F] Live since July 2025. Prices come from Chainlink Data Streams with a market-status flag. "During low liquidity periods, such as weekends & evenings… Kamino accepts prices… provided that prices fall within a custom percentage deviation range of the asset price at last market close" (Kamino forum, 2025-07-14) [27]. Liquidations are permissionless. The default close factor is 25%. The bonus is `max(minBonus, LTV − liqLTV)` capped at `maxBonus` [20]. Stablecoin utilization runs 75–86%. Kraken's xStocks Vaults (launched 2026-09-14) now borrow against xStocks on Kamino through Sentora [28]. Kamino had $24.7M supplied against $5.8M of debt in tokenized stocks (2026-08-28) [29]. [I] Because of the price band, the largest repricing hits when the market reopens or the band edge is reached, not during the closed hours themselves. Bidwall's demo and pitch should target that moment.

**Jupiter Lend.** [F] Standard partial-sale liquidation. The docs warn that the "oracle price may freeze while the xStock token remains tradeable", and that low on-chain liquidity "can lead to bad debt in the vault" [22]. Today in DeFi says Jupiter lets users borrow about $14M against roughly $7M of SPYx/QQQx pool depth [29]. **Jupiter Offerbook** avoids the problem: fixed-term loans with no price liquidation, and the lender claims the collateral at maturity [23].

**Loopscale.** [F] Order-book, fixed-term lending. RWAs were about 40% of deposits in Q1 2026, and xStocks are accepted [30]. Liquidation is price-based. I found nothing xStock-specific.

**Morpho (Base, Coinbase stock tokens).** [F] Five markets, LLTV 62.5–77%, standard permissionless liquidation. Tiny: ~$104K of collateral [11].

**Euler + Ondo (SPYon/QQQon/TSLAon).** [F] Live on Euler since about Feb 2026, priced by Chainlink feeds [31]. I found no published closed-hours liquidation design.

**Venus (bStocks, BNB Chain). The most relevant finding.** [F] Proposal posted 2026-06-11: a treasury-funded Liquidity Reserve that includes a "$200,000… revolving buffer used to front weekend/low-liquidity liquidations on-chain, replenished after each CEX sell-down", held in a protocol-owned multisig and "subject to legal approval" [24]. A second proposal (2026-07-24) whitelists a "bStock backstop liquidator… a dedicated account for clearing undercollateralized bStock positions" with flash-loan access [25]. [I] This is a designated-liquidator arrangement funded by the protocol's own treasury, which is the off-chain, opaque version of Bidwall.

**Aave Horizon (permissioned RWAs).** [F] Only KYC'd, whitelisted liquidators can liquidate. They repay debt, receive a non-transferable aToken, and redeem through the issuer. NAVLink oracles have hard upper and lower bounds [7][32]. [I] Here the liquidation exit is the issuer's redemption window, not a market.

**Tokenized treasuries (BUIDL, USTB, USYC, ACRED).** [F] Instant exits come from dedicated liquidity facilities: Circle's USDC facility for BUIDL, Superstate's affiliated facility with a cap, and USYC's instant-redemption capacity [33]. ACRED is looped on Morpho with RedStone NAV pricing. Securitize removed its "daily redemption" wording after being asked about quarterly intervals [34]. Multiliquid/Metalayer launched an RWA instant-redemption facility on Solana that buys tokenized funds at a "dynamically priced discount to NAV". It is in talks with DeFi platforms for "automated exit pathways" [35]. [I] **For yield-bearing RWAs, committed exit liquidity already exists, sold by issuers and facility providers.** Tokenized single stocks have no equivalent. Exits depend on AMM depth or on CEX/issuer access that only authorized participants have.

**Oracle guidance.** [F] Chainlink's 24/5 equities guide tells protocols to "pause or restrict all activity until the market reopens" when `marketStatus` is closed, or to allow "restricted trading within a bounded range" [36].

**Explicit market-maker "liquidation partner" deals.** I found no public evidence of named market-maker liquidation-partner agreements for xStocks, Ondo GM, BUIDL, USTB or ACRED. The closest are Venus's in-house backstop liquidator, Horizon's whitelisted liquidators, and the issuers' redemption facilities. [I] Private MM arrangements may exist without public disclosure.

---

## 5. OEV, intents and RFQ

**Chainlink SVR.** [F] Oracle updates go through a private Flashbots MEV-Share channel. Searchers bid to back-run the update with a liquidation, and the winning bid is split between the protocol and Chainlink [37]. On Aave it handled $675M of liquidations and recaptured ~$16M (65% Aave / 35% Chainlink) in its first nine months to Feb 2026 [38]. **Effect:** the liquidation bonus still goes to the liquidator, but competitive bidding pushes most of it back to the protocol. The borrower's penalty is unchanged. Recapture shifts revenue to the protocol, not to borrowers.

**UMA Oval / API3 OEV Network.** [F] Same idea: auction the right to act on a price update first. Oval claims up to 90% recapture [39].

**Pyth Express Relay (Solana).** [F] It auctioned liquidation and swap rights to searchers, and Kamino used it for Swap limit orders that liquidators could fill [40]. **Wound down by Pyth DAO OP-PIP-124 on 2026-07-22** ("<$2,000/month" revenue) [41]. [I] Solana lending currently has no live OEV-recapture layer in common use. That is an open gap, but a thin one: Express Relay died because there wasn't enough revenue in it.

**RFQ (Hashflow, JupiterZ, 1inch Fusion, CoW, UniswapX).** [F] Market makers sign firm quotes per trade. JupiterZ has 15–20+ MMs [42][43]. [I] RFQ quotes last seconds and cover one trade. Nobody sells _term_ commitments ("I'll buy up to N shares at $P for the next 7 days, non-cancellable"). The nearest TradFi analogue is a put option or a standby purchase agreement.

**Intent-based liquidation.** [I] Gearbox "gearbots", Euler operators and Morpho pre-liquidations let borrowers pre-specify exits [9][10][15]. I found no general solver-auction liquidation venue on Solana.

**What this means for Bidwall [I].** Bidwall's fixed-price bid takes the liquidation spread for the _capital provider_. OEV schemes take it for the _protocol_. A lender that runs OEV recapture will prefer recapture over handing the spread to providers, **unless** liquidity is so thin that no searcher shows up. That is exactly the closed-hours tokenized-stock case. So Bidwall should be positioned as a liquidator of last resort for thin markets, not as a way to capture value.

---

## 6. Hackathon prior art

| Project                                       | Event                            | What it does                                                                                                         | Overlap                                                                         |
| --------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **ODL**                                       | Colosseum Frontier 2026 (winner) | RWA liquidation marketplace where liquidator funds buy discounted RWAs (PE, private credit, VC secondaries) [44][45] | Same "liquidation buyers for RWAs" story. Different assets, sold after the fact |
| **Holdline**                                  | Unknown                          | Keeper repays Kamino xStock loans from a reserve before overnight gaps [46]                                          | Borrower-side off-hours protection                                              |
| **Aadukalam / Nightguard**                    | Stocklana (Sep 2026)             | Off-hours liquidation shield (modelled) [47]                                                                         | Borrower side                                                                   |
| **StockReef**                                 | Arbitrum Open House              | Liquidation threshold steps down before close, with permissionless "trims" plus bonus [48]                           | Pre-close deleveraging                                                          |
| **HaltGate**                                  | OKX Dev Day 2026                 | Market state machine that blocks liquidations during halts [49]                                                      | Oracle/halt handling                                                            |
| **Closing Bell (GuTS805)**                    | Stocklana                        | Enforces trading bands on swaps, including liquidations against stock collateral [50]                                | Execution guardrails                                                            |
| **Thales**                                    | Stocklana                        | Covered calls with USDC bids held in escrow [51]                                                                     | Escrowed USDC bids, but for options                                             |
| **Kormos / Squeeze / Collaterize / Credible** | Radar / Breakout                 | Fractional-reserve yield / long-short / honorable mention / remittance [52][53][54]                                  | Low                                                                             |

[F] Stocklana (Solana Foundation, tokenized stocks only) closed on 2026-09-25 with 604 submissions. Judging ran through Oct 2, and **winners were not yet listed when I checked** [55]. [I] With 604 tokenized-stock submissions, Colosseum judges will have seen many off-hours liquidation-protection ideas. I could not get a full-text search of Colosseum's project directory (it is JS-rendered), so prior art there may be incomplete.

---

## 7. Where Bidwall is differentiated vs redundant

### Already solved, or too crowded to lead with

1. **"A backstop pool for liquidations."** Liquity, B.Protocol, HLP, Drift IF, Umbrella, and Compound reserves all do this. Calling Bidwall a backstop pool invites the reply "so, a stability pool."
2. **"Recapture liquidation value / MEV."** SVR, Oval and API3 on EVM. On Solana, Express Relay was tried and shut down for lack of revenue. Bidwall moves value to providers, which lenders won't treat as a benefit.
3. **"Protect borrowers from weekend gaps."** Holdline, Nightguard, StockReef and HaltGate cover this, and the oracle side is handled by Kamino's price band and Chainlink's market-status guidance.
4. **"Fixed-price bids for collateral."** Ajna price buckets already work this way, as do Compound's storefront and RFQ firm quotes. The novelty is not the fixed price alone.
5. **"Committed exit liquidity for RWAs."** For tokenized treasuries and credit funds, this already exists as issuer and facility redemption (Circle/BUIDL, Superstate, USYC, Multiliquid).

### Genuinely unoccupied, as far as I could find

1. **A market-based, on-chain version of Venus's backstop buffer, with outside capital.** Venus is spending its own treasury ($200k) on a multisig buffer plus a whitelisted liquidator to handle weekend bStock liquidations [24][25]. No one offers this as an open, multi-provider product. Pitch: _"Venus had to vote treasury money into a multisig to cover weekend stock liquidations. Bidwall lets anyone underwrite that capacity, priced and time-boxed, so the protocol doesn't have to."_ This is the strongest angle, because it rests on documented demand.
2. **Commitment that can be measured, as an input to risk settings.** Today's measure of exit capacity is AMM depth, which is roughly 3–5x below the tokenized-stock collateral in DeFi [29]. Non-cancellable, term-bound bids give curators a number they can rely on: "covered debt at price P until T". They can set xStock supply and borrow caps against it, which RFQ quotes and withdrawable pools cannot provide. Lead with the dashboard: **committed capacity vs. debt at risk per xStock**. The repo's risk monitor fits here.
3. **Selling term liquidity as a priced product (a standby put).** Nobody on-chain sells "N shares at $P, valid for 7 days, cannot be withdrawn" to lenders. Providers are effectively writing puts paid for by liquidation spread. Making that explicit, with a premium or fee paid by the lender or curator for coverage, makes it a product. Without a premium, providers are writing free options. **[I] Biggest weakness:** if the only reward is the spread between the fixed price and the oracle price when it fills, rational providers set very low prices, and the coverage is worthless when it matters. Solve this before the demo, at least with a narrative (for example, a commitment fee paid by the curator).

### Specific risks to address in the submission

- **Kamino liquidations are permissionless races.** Bidwall gets no priority, so its bids fill only when bots won't. Frame that as intended ("last resort"), not as a flaw.
- **Ajna's Aug 2026 exploit** came from liquidation accounting. Show invariant tests for the repay/deliver/surplus split.
- **Price band behaviour.** The largest repricing comes at reopen or at the band edge. Demo that moment, not "Saturday 3am".
- **Market validation is still open** (see project memory). The Venus forum posts [24][25] are the best evidence available that this need is real.

---

## Sources

1. Liquity v1 SP holdings (Etherscan, Apr 29 2026): https://etherscan.io/address/0x66017d22b0f8556afdd19fc67041899eb65a21bb ; docs https://docs.liquity.org/liquity-v1/faq/stability-pool-and-liquidations
2. Liquity V2 BOLD SP (Liquity blog, n.d.; TVL Aug 2025 per search summary): https://www.liquity.org/blog/liquity-v2-bold-stability-pool-opportunities
3. crypto.news, Feb 2025: https://crypto.news/liquity-v2-outflows-surpass-17m-following-stability-pool-warning/
4. B.Protocol docs (2021–22): https://docs.bprotocol.org/technical-documentation/v2 ; https://www.coindesk.com/business/2021/12/22/bprotocol-raises-22m-to-backstop-defi-liquidations
5. Sky Dog/Clipper docs: https://github.com/sky-ecosystem/mcd-docs-content/blob/master/smart-contract-modules/dog-and-clipper-detailed-documentation.md
6. Aave Umbrella (BGD forum; Aave X, Jun 2025): https://governance.aave.com/t/bgd-aave-safety-module-umbrella/18366 ; https://x.com/aave/status/1930630754255479080
7. Aave Horizon docs (accessed 2026-10-04): https://aave.com/docs/aave-v3/horizon ; Sentora: https://sentora.com/research/articles/aave-horizon-pushes-deeper-into-institutional-credit
8. Compound III docs: https://docs.compound.finance/liquidation/
9. Euler EVK whitepaper: https://github.com/euler-xyz/euler-vault-kit/blob/master/docs/whitepaper.md ; https://docs.euler.finance/learn/liquidations/
10. Morpho pre-liquidations: https://morpho.org/blog/introducing-pre-liquidations-enhanced-loan-management-on-morpho ; https://github.com/morpho-org/pre-liquidation
11. crypto.news, Morpho Coinbase stock markets (2026): https://crypto.news/morpho-adds-usdc-lending-for-five-coinbase-tokenized-stocks/
12. MixBytes on Fluid: https://mixbytes.io/blog/modern-defi-lending-protocols-how-its-made-fluid-vault
13. Ajna FAQ: https://faqs.ajna.finance/faqs/liquidations
14. CryptoTimes, 2026-08-29: https://www.cryptotimes.io/2026/08/29/ajna-v2-loses-775k-on-ethereum-after-attacker-exploits-liquidation-math/
15. Gearbox liquidator-v2: https://github.com/Gearbox-protocol/liquidator-v2
16. SparkLend docs: https://docs.spark.finance/dev/sparklend/core-contracts/pool
17. Buildix, HLP backstop (2026): https://www.buildix.trade/blog/how-hyperliquid-liquidations-work-margin-hlp-adl-2026
18. Elliptic, Apr 2026: https://www.elliptic.co/insights/drift-protocol-exploited-for-286-million-in-suspected-dprk-linked-attack/ ; https://crypto.news/drift-says-insurance-fund-untouched-after-attack-withdrawals-to-resume/
19. Drift IF staking docs: https://docs.drift.trade/insurance-fund/insurance-fund-staking
20. Kamino liquidation docs (accessed 2026-10-04): https://kamino.com/docs/curators/markets/liquidations ; V2 auction description (2024): https://blog.kamino.finance/introducing-kamino-lend-v2-08ad8f52855c
21. CoinCodeCap MarginFi review (Aug 2026): https://coincodecap.com/marginfi-review
22. Jupiter Lend xStocks docs: https://jupiter-support.mintlify.app/user-docs/earn/lend/borrow/xstocks
23. Jupiter Offerbook docs: https://docs.jup.ag/user-docs/earn/offerbook
24. Venus forum, 2026-06-11: https://community.venus.io/t/bnb-chain-liquidity-reserve-institutional-fixed-rate-vault-backstop-bstock-liquidation-buffer/5823
25. Venus forum, 2026-07-24: https://community.venus.io/t/bnb-chain-ethereum-ebtc-delisting-lisusd-resumption-bstock-liquidator-flash-loans/5872
26. Ajna whitepaper / FAQ: https://www.ajna.finance/pdf/Ajna_Protocol_Whitepaper_01-11-2024.pdf ; https://faqs.ajna.finance/faqs/lending
27. Kamino governance forum, 2025-07-14: https://gov.kamino.finance/t/kamino-is-integrating-xstocks-powered-by-the-chainlink-data-standard-to-enable-tokenized-equities-lending/792
28. Genfinity, 2026-09-14: https://genfinity.io/2026/09/14/kraken-xstocks-vaults-kamino-veda-sentora-tokenized-stock-yield/
29. Today in DeFi, 2026-08-28: https://news.todayindefi.com/p/tokenized-stocks-can-now-earn-you
30. SolanaCompass Loopscale (2026): https://solanacompass.com/projects/loopscale
31. Coin Republic, 2026-02-12: https://www.thecoinrepublic.com/2026/02/12/ondo-tokenized-stocks-go-live-on-ethereum-defi/
32. Bitget/Securitize NAVLink: https://www.bitget.com/news/detail/12560605052136
33. Eco, tokenized treasuries 2026: https://eco.com/support/en/articles/15210582-top-tokenized-treasury-funds-2026-buidl-ousg-usdy-benji-compared ; https://superstate.com/assets/ustb
34. Unchained on ACRED looping: https://unchainedcrypto.com/defi-looping-comes-to-apollos-1-3-billion-credit-fund-what-could-go-wrong/ ; CoinDesk 2025-04-30: https://www.coindesk.com/markets/2025/04/30/tokenized-apollo-credit-fund-makes-defi-debut-with-levered-yield-strategy-by-securitize-gauntlet
35. FinTech Weekly (Multiliquid/Metalayer): https://www.fintechweekly.com/news/multiliquid-metalayer-rwa-instant-redemption-solana
36. Chainlink 24/5 equities guide: https://docs.chain.link/data-streams/rwa-streams/24-5-us-equities-user-guide
37. Chainlink SVR docs: https://docs.chain.link/data-feeds/svr-feeds
38. Aave blog / Chainlink Q1 2026 review: https://aave.com/blog/historical-liquidations ; https://chain.link/blog/quarterly-review-q1-2026
39. UMA Oval announcement: https://medium.com/uma-project/announcing-oval-earn-protocol-revenue-by-capturing-oracle-mev-877192c51fe2
40. Pyth/Kamino Express Relay: https://www.pyth.network/success-stories/kamino ; https://x.com/KaminoFinance/status/1866122938644128068
41. Pyth DAO OP-PIP-124 (passed 2026-07-22): https://forum.pyth.network/t/passed-op-pip-124-express-relay-wind-down/2642
42. Hashflow docs: https://docs.hashflow.com/hashflow
43. JupiterZ docs: https://jupiterz.jup.ag/
44. Colosseum Frontier winners: https://blog.colosseum.com/announcing-the-winners-of-the-solana-frontier-hackathon/ ; SolanaCompass 2026-06-26: https://solanacompass.com/news/colosseum-announces-26-winners-of-the-solana-frontier-hackathon-the-largest-crypto-hackathon-ever
45. Colosseum Accelerator Cohort 5: https://blog.colosseum.com/announcing-colosseums-accelerator-cohort-5/
46. Holdline: https://github.com/dmustapha/holdline
47. Aadukalam: https://github.com/zkasuran/aadukalam
48. StockReef: https://github.com/4waan/StockReef
49. HaltGate: https://github.com/Len3hq/Haltgate
50. Closing Bell: https://github.com/GuTS805/Stocklana
51. Thales: https://github.com/Canowar1/stocklana-thales
52. Kormos (Colosseum Cohort 4): https://blog.colosseum.com/announcing-colosseums-accelerator-cohort-4/
53. Squeeze (Radar winners): https://solana.com/news/solana-radar-winners
54. Collaterize (Breakout winners): https://blog.colosseum.com/announcing-the-winners-of-the-solana-breakout-hackathon/
55. Stocklana hackathon page (accessed 2026-10-04): https://hackathons.solana.com/hackathons/stocklana

# Research memo A: Kamino xStocks collateral risk and the liquidation-exit stack

Prepared 2026-10-04 for Bidwall (Colosseum, deadline 2026-10-12). Labels: **[V]** verified from a cited source or code; **[API]** read by me from Kamino's public API on 2026-10-04; **[INF]** my inference; **[UNV]** reported by a secondary source and not independently confirmed.

## Summary of findings

- **Oracle prices are frozen over the weekend, so the gap hits at Sunday 20:00 ET.** Kamino prices xStocks with a custom Chainlink Data Streams feed, ingested through Scope. Between "weekends & evenings" it accepts a price only if it falls inside a deviation band around the last market close [V, Kamino forum, 2025-07-14]. Chainlink's equity feeds stop publishing from Friday 20:00 ET to Sunday 20:00 ET [V, Chainlink docs; Aave blog 2026-09-25]. **[INF]** A move in the underlying over the weekend therefore can't trigger a Kamino liquidation. It shows up as a single jump when the overnight session reopens on Sunday at 20:00 ET. Bidwall's moment of need is Sunday night and the overnight session, not Saturday.
- **Kamino has no liquidation auction today.** In the open-source klend program (commit a0876097, 2026-08-18) the bonus is fixed by formula: `max(minBonus, LTV − liquidationLTV)`, capped at `maxBonus` and at `1 − LTV`. The source contains no auction logic, even though the 2024 V2 announcement described Dutch-auction liquidations [V, code; V2 blog].
- **The TWAP check does not block liquidations.** The checks klend requires before a liquidation are price loaded, price age, and price usage allowed. TWAP-divergence and heuristic checks are not among them [V, code]. A reopening gap that fails the TWAP check would still allow liquidations.
- **No public xStock liquidation incident, bad debt or post-mortem found.** Kamino reports $0 bad debt protocol-wide, including through Oct 2025 and Feb 2026 [V/UNV]. I found no write-up of a tokenized-stock stress event on Kamino or Jupiter Lend.
- **The market is still small.** The public xStocks market has $5.18M USDC debt against $5.72M USDC supplied [API]. That is roughly flat since April 2026, when $5.75M was borrowed of $6.3M supplied (92% utilisation) [V, xStocks news]. Borrowing looks capped by lender USDC supply, not by borrower demand.
- **The Sentora market is the Kraken-vault venue (strong inference), and it is smaller.** "Sentora xStocks Market" (`8BNU…6vjr`, `isCurated: true`) holds only SPYx $1.86M, NVDAx $0.58M and QQQx $0.43M, about $2.9M of collateral. It has $6.33M PYUSD supplied and $1.69M borrowed [API]. Its assets exactly match the three Kraken vault assets, but that link is [INF].
- **Kraken controls the whole exit stack.** It owns the issuer (Backed, acquisition announced 2025-12-02). It runs 24/7 Kraken Pro books for all of the main Kamino collateral names (since 2025-12-03). It distributes the xStocks Vaults. And the issuer RFQ, xChange, is open only to onboarded, KYC'd clients.
- **The clearest unmet exit-liquidity need is outside Kamino.** Aave V4's Base Equities Hub (live 2026-09-25) has $0.27M–$1.08M of depth per token at 2% price impact, and seized tokens can't be redeemed by ordinary liquidators. Aave's Monad proposal (2026-09-28) drew a community comment on 2026-10-02 that exit depth is not addressed. Jupiter Lend runs higher liquidation thresholds (75–85%) on xStocks.
- **A rival Colosseum project targets the same window from the borrower's side.** Holdline (repo created 2026-09-25) is a keeper-run, repay-only vault that pays down Kamino xStock loans during market closure.

## 1. How Kamino handles xStocks collateral risk

**Oracle.** Kamino launched the xStocks market on 2025-07-14. It runs on a "bespoke" Chainlink Data Streams feed that draws prices from multiple US exchanges and carries "a real-time market status feed and staleness indicator". Kamino's description of the price band: "during low liquidity periods, such as weekends & evenings where prices are static and pre and post periods where prices are volatile, Kamino accepts prices streamed by Chainlink, provided that prices fall within a custom percentage deviation range of the asset price at last market close" [V, https://gov.kamino.finance/t/…/792, 2025-07-14]. The band width is not published.

Chainlink's 24/5 equity streams launched on 2026-01-21. They cover four sessions: pre-market 04:00–09:30, regular, post-market 16:00–20:00 and overnight 20:00–04:00 ET [V, https://a-teaminsight.com/…, 2026-01; https://docs.chain.link/data-feeds/tokenized-equity-feeds, accessed 2026-10-04]. Chainlink's docs say that while markets are closed "these feeds do not publish updates, including heartbeat updates". They also tell lending protocols to "implement transition-aware logic" and to consider "pausing or restricting operations during transition windows".

**Scope code [V, https://github.com/Kamino-Finance/scope, HEAD 2026-10-01, `oracles/chainlink.rs`].**

- Each xStock feed has a `MarketStatusBehavior` setting: `AllUpdates`, `Open` or `OpenAndPrePost`. Under `Open` and `OpenAndPrePost`, Scope rejects stale reports received while the market is Closed (`OutsideMarketHours`). The stored timestamp is `min(observations_ts, clock)`.
- Ahead of corporate actions, Scope suspends a ChainlinkX price 24 hours before the action date and holds it until a multiplier is manually approved. **[INF]** That is a separate, scheduled pause on liquidations for an affected asset.
- I found no "deviation from last close" logic in `chainlink.rs`. The band Kamino describes probably sits in reserve heuristics or price-chain configuration [UNV].
- I could not confirm on-chain which `MarketStatusBehavior` each xStock reserve uses; my RPC probe failed because of a tooling error. **[INF]** Either way the outcome over the weekend is the same. The price is either refreshed but static, or rejected so that it ages past klend's 300s limit, which blocks liquidations. In neither case can a weekend move cause a liquidation.

**Liquidation mechanics [V, https://github.com/Kamino-Finance/klend/tree/a08760976f51 (2026-08-18); https://kamino.com/docs/curators/markets/liquidations].**

- **Who can liquidate:** anyone, through `liquidate_obligation_and_redeem_reserve_collateral`.
- **Bonus:** the formula above. At an unweighted LTV of 99% or more, the bonus switches to `badDebtLiquidationBonusBps`.
- **Close factor:** the docs give 25% as the default; our reads show 20% on this market. It rises to 100% near insolvency.
- **Size caps:** a per-transaction debt cap (`max_liquidatable_debt_market_value_at_once`, $1M per our reads) and a small-position full-liquidation threshold.
- **Pause switch:** a market-wide `price_triggered_liquidation_disabled` flag.
- **Loss handling:** an `autodeleverage` path exists, and `socialize_loss` can be called by the owner or the emergency council.
- **No auctions:** a search of the source for "auction" returns nothing. The auction design in the V2 announcement (https://blog.kamino.finance/introducing-kamino-lend-v2-08ad8f52855c, 2024; date not re-verified) is not in the deployed program.
- **[INF]** With `protocolLiquidationFeePct` at 50%, a liquidator keeps only about 2.5–5% of the bonus. That is thin compensation for carrying inventory in a single stock over a gap.

**Who sets the parameters.**

- Allez Labs is Kamino's risk partner. It maintains the KRAF dashboard and has published 14+ monthly risk reports, and a Risk Council can propose parameter changes [V, https://kamino.com/docs/risk/kraf-dashboard, accessed 2026-10-04].
- No xStocks-specific parameter proposal or rationale turned up on gov.kamino.finance. **The reasoning behind MSTRx 30% (and HOODx/CRCLx 30%, AAPLx 40%) is unpublished [UNV].**
- At launch, max LTVs were 35–50% [V, https://www.onchaintimes.com/stocks-arriving-on-chain/, 2025-07-28]. They have since risen to 73% (SPYx), 70% (QQQx) and 60% (GOOGLx) [API].
- **[INF]** The tiers follow volatility. The nearest published method is Aave/TokenLogic's: volatility tiers plus "the 99th percentile of historical weekend downside gaps", with maximum observed gaps of 14.1–14.5% [V, https://governance.aave.com/t/arfc-deploy-aave-v4-on-the-monad-network/25722, 2026-09-28].
- The public market also accepts USDC as collateral for borrowing xStocks, i.e. shorts [V, Kamino on X, ~2026-04]. SPYx and QQQx each had about $0.08–0.09M borrowed [API].

## 2. Incidents, bad debt, post-mortems

- Kamino posted after the October 2025 crash: "Kamino users incurred a total of $0 bad debt, and … the liquidation engine performed exactly as expected" [V, https://x.com/kamino/status/1976782632349479039, ~2025-10-11]. I read the text only from the search snippet.
- The KRAF docs cite the February 2026 SOL −18% event as producing $0 bad debt [V].
- No xStock-specific liquidation incident, oracle failure or post-mortem was found on Kamino, Jupiter Lend or Save. Treat this as "not found", not "proven absent".
- Kraken's FAQ says Monday-open mismatch has "historically [been] under 1%" [V, https://support.kraken.com/articles/xstocks-faq, accessed 2026-10-04]. That figure comes from an interested party.
- Jupiter Lend's own docs warn that "the oracle price may freeze while the xStock token remains tradeable on-chain" and that bad debt can occur if "the protocol cannot liquidate fast enough" [V, https://jupiter-support.mintlify.app/user-docs/earn/lend/borrow/xstocks].
- Coinspress puts Kamino's peak xStock holdings at "$31M+" [UNV, https://coinspress.com/…, 2026-10]. Today's total is about $19.4M ($16.5M public + $2.9M Sentora). **[INF]** If the peak figure is right, collateral has fallen off its high.

## 3. The liquidity stack for exiting xStocks

**Issuer primary market.**

- Issuance and redemption are "limited to business days when the US market is open, normally 24/5". Access requires KYC/AML and a whitelisted wallet, and retail redemption has a $5,000 minimum [V, https://docs.xstocks.fi/docs/frequently-asked-questions; https://docs.xstocks.fi/docs/issuance-and-redemption].
- **xChange (atomic RFQ)** is available to "onboarded clients" on EVM chains and Solana [V, https://docs.xstocks.fi/docs/issuance-and-redemption/atomic-rfq-xchange, accessed 2026-10-04]:
  - Quotes are executable for about 60 seconds, with no additional fee.
  - Spreads are tightest in market hours and wider in extended hours.
  - No size limits are published.
  - On Solana, "the client receives a partially-signed transaction which they complete and submit."
- **[INF]** Because the issuer pre-builds and partially signs the transaction, a liquidator probably can't add a Kamino liquidation instruction to it. The realistic pattern is two transactions inside the 60-second window: liquidate, then redeem. That works only for onboarded firms and only 24/5. The Sunday 20:00 ET reopening falls inside the 24/5 window, but at extended-hours spreads.
- Mantle, Bybit and Fluxion turned on xChange on Mantle on 2026-05-07 [V, https://www.newswire.ca/…896908163.html].

**CEX.**

- Kraken Pro trades 10 xStocks 24/7 (TSLAx, QQQx, SPYx, NVDAx, CRCLx, AAPLx, HOODx, MSTRx, GLDx, GOOGLx) since 2025-12-03 [V, https://blog.kraken.com/product/xstocks/24-7-on-kraken-pro].
- Off-hours, market makers price from "ATS platforms, index futures, and internal models", and "spreads are wider outside market hours" [V, Kraken FAQ].
- Non-US Kraken clients can deposit and withdraw on Solana [V, https://www.theblock.co/post/361778/…].
- Bybit spot lists xStocks 24/7 [V, PRNewswire 2025-06-30].
- **No xStocks market maker is publicly named** in any source I found. I could not verify Wintermute, Flowdesk, Keyrock or GSR involvement [UNV].

**DEX.**

- Raydium CLMM is the main venue. It handled $5.77B of tokenized-asset spot volume in Q2 2026, and $2.3B in Q3 through 2026-09-18 [V, https://solanacompass.com/news/xstocks-crosses-6-billion…, 2026-09-18].
- No per-pool depth figures were published. Our own Saturday Jupiter quotes are still the best depth evidence.
- Kraken FAQ also points LPs to Orca and Byreal.

**Issuer weekend initiatives.** Beyond the Kraken Pro 24/7 books, I found none. Chainlink is "working on a 24/7 pricing solution" [V, Aave Monad ARFC, 2026-09-28].

## 4. Kraken xStocks Vaults, Veda and Sentora; the Sentora market

**Launch and mechanics.** The vaults launched on 2026-09-14 for SPYx, QQQx and NVDAx [V, https://genfinity.io/2026/09/14/…; https://solanacompass.com/news/kraken-launches-yield-vaults…].

1. Deposits go into Privy embedded wallets, then a Veda BoringVault on Ink.
2. Chainlink CCIP bridges the assets to Solana.
3. Sentora posts them as Kamino collateral, borrows stablecoins, deploys those into yield strategies, and compounds the returns back into the original xStock.

**Terms.** APY is up to 2% (1.8% for NVDAx), with a 25% performance fee and three-day withdrawals.

**Risk management.** Sentora sets "eligible markets, defines exposure limits, and monitors … liquidation thresholds" and uses "live risk models tracking collateral, liquidity and oracle conditions". No target LTV or deleveraging rule is published.

**Size of the Sentora market [API, 2026-10-04].**

| Reserve | Max LTV | Supplied | Borrowed |
| ------- | ------- | -------- | -------- |
| SPYx    | 0.72    | $1.86M   | —        |
| NVDAx   | 0.62    | $0.58M   | —        |
| QQQx    | 0.70    | $0.43M   | —        |
| PYUSD   | —       | $6.33M   | $1.69M   |

- That is about $2.9M of xStock collateral against about $1.7M of debt. **It is not larger than the public market.**
- The implied average LTV is roughly 59%, against max LTVs of 62–72% [INF]. It is a single professional borrower with tight margins.
- The PYUSD side links to Sentora's PYUSD vault ($133–205M TVL across sources) [UNV, stakingrewards].

**Sector context.** Sentora is a large Kamino curator ($400M of deposits at Q2 end) [UNV, Blockworks Q2 report, X].

## 5. Growth trajectory

- **xStocks overall:** launched 2025-06-30 with about 60 assets. By 2026-09-11 it had about $800M AUM (about $530M on Solana), 700+ assets and $35B+ cumulative volume [V, https://solanacompass.com/news/solana-tokenized-equity-supply-hits-684m-record…, 2026-09-11].
- **Solana tokenized-equity supply:** $684M, up from $465M in late August (+47% in three weeks).
- **Solana volume:** xStocks passed $6B on Solana on 2026-09-18.
- **Tokenized-stock lending:** $23.1M TVL, 82.6% of it on Kamino [V, Cryptobriefing via Bitget, 2026-08-15]. About $53M of tokenized-stock collateral on Solana in late July [UNV, coinspress].
- **Kamino xStocks deposits:** +272% over 90 days to mid-September; stablecoin utilisation 75–86% [V, genfinity 2026-09-14].
- **Deposit caps:** no published cap raises were found. **[INF]** The binding limit is USDC supply in the public market. Debt has not grown since April despite collateral growth, so liquidation exposure will rise only if lenders add USDC, for example through vault allocations or the Kraken/Sentora channel.
- **Competition:** Aave V4 Base Equities Hub (Coinbase tokens, $21M USDC borrow cap, collateral factors 65–79%, LlamaRisk) [V, https://cryptoslate.com/aave-stock-token-loans-expose-usdc-lenders-to-weekend-price-gap/, 2026-09-27]. Proposed Aave Monad xStocks hub with a $15M incentive allocation [V, cryptotimes 2026-09-29].

## Implications for Bidwall

**Where the need is already met.**

- The SPYx and QQQx sizes Kamino actually liquidates (at most $1M per transaction, 20% close factor, $5.2M total debt) are small next to Kraken Pro 24/7 books, Raydium, and xChange for onboarded firms.
- A professional liquidator with Kraken or xChange access and CME futures can hedge on Sunday evening.
- The issuer, the venue and the distributor are all Kraken, which has every reason to backstop its own vault product.

**Where real need may exist.**

1. **The Sunday 20:00 ET / overnight reopening.** Oracles jump, the issuer RFQ quotes extended-hours spreads, and the liquidator keeps only about half the bonus.
2. **Single-stock names.** NVDAx, TSLAx, GOOGLx, MSTRx and AAPLx, where our $1M quotes showed −0.9% to −77% slippage.
3. **Lenders and curators who can't see liquidation capacity.** Sentora and Kamino publish no exit-depth model.
4. **Markets with permissioned redemption or thin depth.** Aave's Base hub (redemption gated by vesting) and the proposed Monad hub, where the community has flagged that exit depth is missing.

**Three strongest arguments for Bidwall.**

1. The oracle freeze puts every weekend gap into one predictable reopening moment. A fixed-price bid that is funded in advance and inspectable on-chain is exactly what a curator wants to see before raising LTVs or caps. The LTV rise from 35–50% to 60–73% shows demand to lend more.
2. Liquidator economics are thin. After the 50% protocol fee the net bonus is about 2.5–5%, and there are no auctions, so bonus discovery can't adjust. Committed buyers make liquidation execution certain rather than best-effort.
3. The underlying problem is spreading across chains (Aave Base, Aave Monad, Jupiter Lend at higher thresholds), so Bidwall's lender-adapter design applies beyond Kamino.

**Three weakest arguments.**

1. The Kamino exposure is tiny (about $5–7M of debt across both markets), and debt has not grown since April. The total possible fee pool is small, and Kamino reports no bad debt.
2. Kraken controls issuance, 24/7 CEX books and the vault channel. The best-placed backstop provider is the incumbent, and xChange already offers about 60-second executable redemption to onboarded firms.
3. A fixed-price, non-cancellable bid is a free option to borrowers and to the oracle reopening print. Capital providers will want deep discounts that may exceed the 2.5–5% the liquidation route yields. Holdline also attacks the same window from the borrower side with repay-first protection.

**Open verification items.** The on-chain `MarketStatusBehavior` and band width per xStock reserve (needs a fixed probe); whether any liquidations hit at the Sunday 20:00 ET reopening (a scan of liquidation transaction history); and the Raydium per-pool depth at the reopening.

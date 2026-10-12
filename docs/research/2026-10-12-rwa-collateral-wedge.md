# RWA collateral exit liquidity: a wedge for Bidwall, 12 October 2026

Follow-up to the [Jupiter Lend exposure check](2026-10-12-jupiter-lend-exposure.md),
which found xStock lending too small and too conservative to need Bidwall today.
This scan asks where Bidwall's primitive would meet a real, current problem.

## Finding 1: tokenized credit is where the collateral sits

All 45 Kamino markets were read through `api.kamino.finance` on 12 October.

| Market                                                            | Collateral | Stablecoin debt |
| ----------------------------------------------------------------- | ---------: | --------------: |
| OnRe (ONyc)                                                       |    $155.7M |          $87.7M |
| Ethena (USDe)                                                     |    $151.2M |         $108.5M |
| Figure (PRIME)                                                    |     $94.3M |          $78.7M |
| AUTO                                                              |     $78.1M |          $55.6M |
| Maple (syrupUSDC)                                                 |     $55.9M |          $46.8M |
| Huma (PST)                                                        |     $42.0M |          $27.4M |
| Superstate (FWDI)                                                 |     $22.7M |           $4.8M |
| reUSD, sUSDai, Obligate (oTFY), Nest (nOPAL), Solstice and others |      ~$50M |           ~$37M |

About **$446M of stablecoin debt** sits in RWA and yield-token markets, against
about $5.2M in the xStocks market. Maximum LTVs run 66–92%.

## Finding 2: exit depth is either issuer-funded or missing

Jupiter sell quotes to USDC, measured against Kamino's oracle price:

| Token     | $100k    | $1M      | $5M      |
| --------- | -------- | -------- | -------- |
| PRIME     | −2 bp    | −4 bp    | −18 bp   |
| syrupUSDC | −1 bp    | −2 bp    | −7 bp    |
| PST       | −1 bp    | −2 bp    | −3 bp    |
| ONyc      | −31 bp   | −52 bp   | **−43%** |
| AUTO      | −3 bp    | −10 bp   | **−98%** |
| USDe      | +7 bp    | +1 bp    | **−80%** |
| reUSD     | −1 bp    | −7 bp    | no route |
| sUSDai    | −8 bp    | −10 bp   | no route |
| oTFY      | −31 bp   | no route | no route |
| nOPAL     | no route | no route | no route |
| FWDI      | no route | no route | no route |

- Large issuers that want DeFi distribution provide deep exits themselves.
- ONyc, AUTO and Solana USDe hit a cliff between $1M and $5M against $78–155M
  of collateral each.
- FWDI ($22.7M collateral) and nOPAL ($6.1M) have no DEX route at all.
  Liquidating them depends on someone pre-arranged to buy.

## Finding 3: an issuer is already paying for exactly this

On 24 September 2026 OnRe launched the
[OnRe Liquidity Engine](https://solanacompass.com/news/onre-liquidity-engine-launches-for-onyc-capital-backed-rfq-quotes-routed-by-titan):
contract-generated ONyc quotes funded by about 15% of OnRe's underwriting capital,
routed by Titan. The stated reason is that "lenders who accept ONyc as collateral
need to be able to sell it when a position is liquidated." OnRe reported over
$225M of ONyc in Solana DeFi, $166.6M of it on Kamino.

That is an issuer tying up about 15% of its capital, which could otherwise be
underwriting, to make its token liquidatable.

## Why Bidwall fits this better than xStocks

- **Fixed-price bids suit NAV-anchored assets.** On a volatile stock, a fixed-price
  non-cancellable bid is a free put. On a credit token whose NAV moves slowly, a
  bid at NAV minus a discount is a natural standing price.
- **Providers have an edge.** A buyer who can redeem with the issuer buys at a
  discount during a liquidation and exits at NAV through the redemption queue.
  Their risk is duration and credit, which credit funds already price.
- **Permissioned collateral needs pre-arranged buyers.** Allowlisted tokens cannot
  be liquidated by open bots. Committed bids from allowlisted providers are the
  on-chain version of Aave Horizon's whitelisted liquidators.
- **The settlement path is built.** Bidwall's bids already settle into Kamino's
  liquidation instruction atomically; these markets run on the same program.

## Proposed wedge

> Issuers shouldn't have to lock their own balance sheet to make their token
> safe collateral. Bidwall lets credit funds and market makers post committed,
> funded bids at NAV minus a discount that settle straight into lender
> liquidations, so lenders can list RWAs and risk teams can count the capacity.

Customers: RWA issuers seeking lending listings and higher LTVs (budget proven by
OnRe). Supply: credit funds and market makers with redemption access. Users:
Kamino, Loopscale and Jupiter Lend risk teams.

## Unknowns to state openly

- No issuer has said it would rent this rather than fund it in-house.
- Liquidation volume in these markets is not yet measured here. A third-party
  claim of about $230M of ONyc liquidations cleared without bad debt is unverified.
- Large issuers (Figure, Maple, Huma) already have deep exits; the gap is ONyc
  above about $1M, AUTO, USDe on Solana, and the long tail.
- Permissioned tokens need allowlist and Token-2022 transfer-hook handling;
  the current adapter is verified only on the public NVDAx/USDC route.
- Quotes are single snapshots on 12 October and not executed trades.

Scratch data: `/tmp/bw-ev/mk/`, `/tmp/bw-ev/depth.py` (not committed).

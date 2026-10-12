# Bidwall

**Committed exit liquidity for tokenized credit used as collateral on Solana.**

A provider escrows USDC in a funded, fixed-price, term-bound bid for one collateral
token. When a lender liquidates a loan backed by that token, Bidwall settles inside
the lender's own liquidation instruction. In one transaction it repays the debt,
delivers the seized collateral to the provider, pays any surplus to the borrower,
and reduces the bid's remaining capacity. It needs no DEX depth to do this.

This is a hackathon prototype that runs on a local mainnet fork. It is **not a
public or production deployment.**

## The problem

About **$446M of stablecoin debt** is borrowed on Kamino against yield-bearing
credit and RWA tokens, at maximum LTVs of 66–92% (12 October 2026). For comparison,
tokenized-stock debt there is $5.2M. To be safe as collateral, these tokens have to
be sellable when a loan is liquidated. Many are not:

| Token (Kamino collateral)             | Jupiter sell, $1M | Jupiter sell, $5M |
| ------------------------------------- | ----------------: | ----------------: |
| ONyc, OnRe reinsurance ($155M)        |            −52 bp |          **−43%** |
| AUTO ($78M)                           |            −10 bp |          **−98%** |
| FWDI, Superstate ($23M)               |      **no route** |      **no route** |
| PRIME, syrupUSDC, PST (issuer-funded) |           ≤ −4 bp |          ≤ −18 bp |

Issuers who want their tokens accepted as collateral end up paying for the exit
themselves. On 24 September 2026 OnRe launched a liquidity engine funded by
**about 15% of its own underwriting capital**, because "lenders who accept ONyc as
collateral need to be able to sell it when a position is liquidated."

## The insight

A fixed-price, non-cancellable bid is a bad deal for the provider on a volatile
stock: it amounts to giving away a free put. On a credit token that redeems at a
slow-moving NAV, the same bid is a natural standing price. A credit fund that can
redeem with the issuer buys at a discount during a liquidation and exits at NAV
through the redemption queue. Issuers rent that capacity instead of locking their
own balance sheet. Lenders and risk teams can see exactly how much is committed,
at what price, and until when.

## What is built

- **Bidwall program** (Anchor): funded, fixed-price, term-bound bids with bounded
  partial fills, expiry and refunds. Settlement goes through Kamino Lending v2's
  `liquidate_obligation_and_redeem_reserve_collateral_v2` by CPI, with
  balance-delta verification and full rollback if any check fails.
- **Two real Kamino reserve pairs:**
  - **OnRe ONyc/USDC**: a real looped loan at the 66% max LTV. On the fork the ONyc
    NAV is stressed to $0.95, Kamino's lowest accepted price. Kamino repays 1,000
    USDC of debt, the provider receives 1,078.79 ONyc at a $1.00 bid, and the
    borrower receives 78.79 USDC of surplus.
  - **xStocks NVDAx/USDC**: the original route, retained.
- **Offline replay fixtures** of both liquidations, using the deployed Kamino and
  Farms binaries. These run in the test suite without network access.
- **Risk measurement**: decodes every loan in a Kamino market and every Jupiter Lend
  xStock position (7,369), runs price-stress scenarios, and compares the results
  with hourly mainnet exit-depth evidence.
- **Web console**: runs the full NVDAx commitment and liquidation lifecycle locally.

## What we found along the way

We started with tokenized stocks and measured both Solana lenders. At today's
conservative LTVs, neither runs short of exit liquidity in plausible price moves.
The only gap is a ~30% index crash on QQQx
([write-up](docs/research/2026-10-12-jupiter-lend-exposure.md)). That result is
what moved Bidwall to tokenized credit, where the collateral, the exit gap and a
paying issuer all exist ([wedge analysis](docs/research/2026-10-12-rwa-collateral-wedge.md)).

## Run it

Prerequisites: [toolchain](docs/TOOLCHAIN.md), Surfpool 1.3.0, Node.js and pnpm 12.5.1.

```sh
pnpm install --frozen-lockfile --ignore-scripts
npm run anchor-test   # SBF builds; 44 workspace tests, including both Kamino replays
npm run test:client   # typed client and fixture-manifest tests
npm run dev:demo      # local console at http://127.0.0.1:3000 (NVDAx lifecycle)
```

To reproduce the ONyc liquidation against live mainnet state on a local fork:

```sh
npm run anchor-build && npm ci --prefix spikes/kamino-cpi
NO_DNA=1 surfpool start --port 18899 --ws-port 18900 --no-deploy --no-tui --airdrop-amount 0
PAIR=onyc node spikes/kamino-cpi/scenario.mjs   # in another terminal
```

The scenario first shows Kamino rejecting the healthy loan. It then stresses only
the fork's Scope ONyc price and settles the liquidation through Bidwall. Lender
debt, reserves and collateral are real mainnet state.

## Limits

- Local fork only. There is no mainnet deployment and no independent audit.
- Supported pairs are a fixed table (ONyc/USDC and NVDAx/USDC on Kamino). Other
  reserves fail closed. Permissioned tokens with allowlists or transfer hooks are
  not yet supported.
- No issuer, lender or capital provider has committed to use Bidwall. The demand
  evidence is public: OnRe's in-house engine and measured exit depth.
- Kamino liquidations are permissionless. Bidwall bids get no priority and fill when
  they are the best available exit.

## Docs

[Component status](docs/STATUS.md) ·
[Kamino integration](docs/KAMINO-INTEGRATION.md) ·
[Risk monitor](docs/RISK-MONITOR.md) ·
[Quote observer](docs/QUOTE-OBSERVER.md) ·
[Operator demo](docs/OPERATOR-DEMO.md) ·
[Research](docs/research/)

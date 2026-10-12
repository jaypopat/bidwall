# Bidwall

**Committed exit liquidity for tokenized credit used as collateral on Solana.**

Credit funds post funded, fixed-price bids for RWA collateral. When a lender
liquidates a loan, the bid buys the collateral inside the same transaction, so
the lender is repaid without relying on DEX depth.

> Hackathon prototype. Runs on a local mainnet fork and offline replays of real
> Kamino state. Not deployed to mainnet.

## The problem

About **$446M** is borrowed on Kamino against tokenized credit and RWA tokens
(tokenized stocks: $5.2M). A lender can only accept collateral it can sell when a
loan goes bad, and much of this collateral can't be sold at size:

| Collateral on Kamino    | Collateral | Cost to sell $5M on Jupiter |
| ----------------------- | ---------: | --------------------------: |
| ONyc (OnRe reinsurance) |    $155.7M |                    **−43%** |
| USDe                    |    $151.2M |                    **−80%** |
| AUTO                    |     $78.1M |                    **−98%** |
| FWDI (Superstate)       |     $22.7M |         **no route at all** |
| PRIME, syrupUSDC, PST   |          — |     ≤ −0.2% (issuer-funded) |

The tokens that sell cleanly are the ones whose issuers pay for the exit. OnRe
just did exactly that: on 24 September 2026 it launched a liquidity engine funded
with **~15% of its own underwriting capital**, because "lenders who accept ONyc as
collateral need to be able to sell it when a position is liquidated."

Every issuer that wants its token to be good collateral faces the same bill.

## The solution

Bidwall turns that exit into a product someone else can supply. A provider (a
credit fund or market maker) locks USDC in a bid: _"I will buy up to 5,000 ONyc at
$1.00 until Friday."_ The funds can't be withdrawn early, so lenders and risk teams
can count on them.

```mermaid
flowchart LR
    P[Provider<br/>credit fund] -- "escrows USDC<br/>fixed price · size · term" --> B[(Bidwall bid)]
    L[Unhealthy loan<br/>on Kamino] -- liquidation --> B
    B -- "repays debt" --> K[Kamino lender]
    B -- "surplus" --> W[Borrower]
    B -- "collateral" --> P
```

**Why this works for credit and not for stocks.** A fixed-price bid on a volatile
stock is a free option for whoever hits it, so nobody sensible posts one. Credit
tokens track a slow-moving NAV, so "NAV minus a small discount" is a natural
standing price. A provider that can redeem with the issuer buys at a discount
during a liquidation and exits at NAV. The issuer rents the capacity instead of
locking its own balance sheet.

## How a settlement works

One transaction, signed by a keeper. Bidwall calls Kamino's own liquidation
instruction (`liquidate_obligation_and_redeem_reserve_collateral_v2`) and checks
every balance before and after. If any check fails, the whole transaction reverts,
including Kamino's side.

```mermaid
sequenceDiagram
    participant Keeper
    participant Bidwall
    participant Kamino
    Keeper->>Bidwall: settle(bid, loan, bounds)
    Bidwall->>Bidwall: bid active, in term, quote matches state
    Bidwall->>Kamino: liquidate (repay USDC from escrow)
    Kamino-->>Bidwall: seized collateral
    Bidwall->>Bidwall: verify debt, collateral and vault deltas
    Bidwall-->>Bidwall: price × quantity, reduce capacity
    Note over Bidwall: collateral → provider<br/>surplus → borrower<br/>unused budget → escrow
```

## Proof: a real ONyc loan

A real looped ONyc loan at 66% LTV, from mainnet state:

1. Kamino **refuses** to liquidate it: it's healthy (65.4% LTV).
2. We lower ONyc's oracle price on the fork to $0.95, Kamino's floor.
3. Bidwall settles the liquidation in one transaction:

| Leg                                |                 Amount |
| ---------------------------------- | ---------------------: |
| Paid from the bid escrow           |          1,078.79 USDC |
| → debt repaid to the Kamino lender |          1,000.00 USDC |
| → surplus paid to the borrower     |             78.79 USDC |
| ONyc delivered to the provider     | 1,078.79 ONyc at $1.00 |

No DEX was involved. The same flow also runs for NVDAx (tokenized Nvidia).

## What's built

- **Anchor program**: funded bids with partial fills, expiry, refunds and
  exhaustion; settlement into Kamino Lending v2 for ONyc/USDC and NVDAx/USDC.
- **Offline replays** of both liquidations against the deployed Kamino binaries.
  44 Rust tests and 6 client tests, no network needed.
- **Web console** that runs the whole lifecycle: fund, blocked early withdrawal,
  blocked healthy-loan liquidation, settlement, exhaustion, expiry.
- **Risk research**: every xStock loan on Kamino and Jupiter Lend measured against
  live exit depth. That's what moved us from stocks to credit
  ([stocks](docs/research/2026-10-12-jupiter-lend-exposure.md),
  [credit](docs/research/2026-10-12-rwa-collateral-wedge.md)).

## Run it

Needs the [toolchain](docs/TOOLCHAIN.md), Surfpool 1.3.0, Node.js and pnpm 12.5.1.

```sh
pnpm install --frozen-lockfile --ignore-scripts
npm run anchor-test   # program build + 44 tests, including both Kamino replays
npm run dev:demo      # console at http://127.0.0.1:3000
```

To replay the ONyc liquidation against live mainnet state on a fork:

```sh
npm run anchor-build && npm ci --prefix spikes/kamino-cpi
NO_DNA=1 surfpool start --port 18899 --ws-port 18900 --no-deploy --no-tui --airdrop-amount 0
PAIR=onyc node spikes/kamino-cpi/scenario.mjs   # in another terminal
```

## Limits

- Fork and replay only: no mainnet deployment, no audit.
- Two supported pairs. Permissioned tokens (allowlists, transfer hooks) are next.
- No issuer or provider has signed up yet. The demand evidence is OnRe's in-house
  engine and the measured exit depth above.
- Kamino liquidations are open to anyone. A bid fills only when it's the best exit.

[Status](docs/STATUS.md) · [Kamino integration](docs/KAMINO-INTEGRATION.md) ·
[Operator demo](docs/OPERATOR-DEMO.md) · [Risk monitor](docs/RISK-MONITOR.md) ·
[Research](docs/research/)

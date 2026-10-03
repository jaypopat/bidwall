# Bidwall

Bidwall is a Solana hackathon prototype for funded, term-bound NVDAx/USDC liquidation bids. A provider escrows purchase capital in advance; an eligible Kamino v2 liquidation can atomically repay debt, deliver collateral to that provider, pay borrower surplus and reduce remaining bid capacity. The demonstrated route is deliberately narrow and is **not a public or production deployment**.

## Run the local demo

Prerequisites: [toolchain](docs/TOOLCHAIN.md), Surfpool 1.3.0, Node.js and pnpm 12.5.1.

```sh
pnpm install --frozen-lockfile --ignore-scripts
npm run dev:demo
```

Open <http://127.0.0.1:3000>. The console's **Run local scenario** button builds the programs and client, starts a fresh offline Surfpool runtime, uses ephemeral local test signers, runs the complete commitment and liquidation sequence, and displays the receipt. The runtime stops afterward. The API is enabled only for the loopback-bound development server; ordinary `npm run dev` does not expose execution.

The [quote observer](docs/QUOTE-OBSERVER.md) records hourly mainnet exit-depth evidence.
The [market risk monitor](docs/RISK-MONITOR.md) pairs price-stress scenarios for
Kamino loans with that evidence; use **Market risk → Scan market** in the console.
The local demo includes a separate bid-exhaustion case and actual commitment dates.
After a passed run, **Get mainnet quote** compares the exact delivered quantity with
a timestamped indicative quote; it does not execute a swap.

For a terminal-only run, use `npm run demo:kamino`. Read [operator demo](docs/OPERATOR-DEMO.md) for the sequence and [frontend scope](docs/FRONTEND.md) for what the browser does and does not yet operate. The [component status](docs/STATUS.md) is the quickest project map.

## Verify

```sh
npm run anchor-test   # SBF builds and 42 workspace tests
npm run test:client   # typed client and fixture-manifest tests
npm run ci            # web build, lint and formatting
```

The [canonical brief](docs/RWA-LIQUIDATION-DEPTH.md), [critical review](docs/RWA-LIQUIDATION-DEPTH-REVIEW.md), [evidence appendix](docs/RWA-LIQUIDATION-DEPTH-EVIDENCE.md), and [Kamino integration evidence](docs/KAMINO-INTEGRATION.md) explain the product, supported route and limits. The [next milestone plan](docs/NEXT-MILESTONE.md) lists remaining functionality and decisions.

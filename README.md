# Bidwall

Funded, fixed-price bids that settle inside Kamino liquidations of tokenized
collateral on Solana. Supports ONyc/USDC and NVDAx/USDC in local fork and offline
replay scenarios.

[Hosted demo](https://bidwall-omega.vercel.app)

## Local development

Prerequisites: Node.js, pnpm 12.5.1, Anchor CLI 1.1.2, Solana build-sbf 3.1.15,
Rust (tested with 1.96.0) and Surfpool 1.3.0.

```sh
pnpm install --frozen-lockfile --ignore-scripts
npm run anchor-test
npm run dev:demo
```

Open <http://127.0.0.1:3000>. The console runs local scenarios using test funds.
Local program identities are deterministic public test keys; use new identities
for any public deployment.

## Checks

```sh
npm run ci
npm run test:client
npm run anchor-test
```

`npm run setup` builds the programs and regenerates the TypeScript bindings.
Captured Kamino and Token-2022 binaries are retained for offline tests; their
license notices are in `anchor/programs/bidwall/fixtures/licenses/`.

This is an unaudited prototype, with no mainnet deployment.

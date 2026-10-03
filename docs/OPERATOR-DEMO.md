# Local operator demo and shared client (milestone 4)

The demo now runs the complete commitment lifecycle against the captured real
Kamino program without an upstream RPC connection. The same typed client can be
used by the future console. No contract behavior was changed in this milestone.

## Run it

Prerequisites: the [Anchor/Rust toolchain](TOOLCHAIN.md), Surfpool 1.3.0, Node.js
(tested with 24.21.0) and the package manager pinned in `package.json` (pnpm 12.5.1).
From the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
npm run demo:kamino
```

For the browser console, run `npm run dev:demo` and open
<http://127.0.0.1:3000>. The Run local scenario button executes this same
command and renders its verified receipt. See [frontend scope](FRONTEND.md): the
page is a scripted local launcher and receipt viewer, not wallet-driven bidding.
Its stage cards advance during the run and distinguish confirmed transactions,
simulation rejections and the local oracle override.

Commitment start and expiry come from the funded bid account and use the historical
local scenario clock. After the main lifecycle, the runner performs a separate
exact-capacity replay. **Get mainnet quote** requests an optional read-only Jupiter
sell quote for the exact quantity delivered in the passed receipt. It is not part
of the offline execution and never builds or sends a swap.

`npm run` executes scripts only; dependency installation uses pnpm and its committed
lockfile. The obsolete starter Bun lockfile was removed. The optional resolver
fallback build is explicitly disabled in `pnpm-workspace.yaml`; installed platform
bindings passed the build and lint checks on the development Linux host.

The command builds SBF/IDL artifacts, compiles the shared client, starts a fresh
**offline** Surfpool process on `127.0.0.1:18999`, runs the scenario, exports evidence,
and stops the process. It refuses to attach to an occupied RPC or WebSocket port.
Set `BIDWALL_DEMO_PORT` to use another local port (the next port is used for WebSocket).
Running the command again starts a new scenario.

It does not use a personal wallet, public RPC, or the research spike's SDK packages.
Fresh ephemeral local signers and test funds are created for each run. Dependency
installation and an uncached Rust build can still require network access.

## What it does

1. Verify the committed fixture and deployed-program hashes against its manifest.
2. Seed the captured lender state and programs into the local runtime; load the
   freshly built Bidwall program. Seed local SOL and provider USDC.
3. Create a market and create/fund/activate a 1,500-USDC bid for up to
   `1,000,000,000` raw NVDAx atoms at 150 USDC per `100,000,000` raw atoms.
4. Create the liquidator, provider and borrower destination token accounts using
   normal associated-token instructions. Create and extend a real lookup table.
5. Simulate and reject early withdrawal, then reject liquidation of a locally
   healthy loan (scenario Scope spot/TWAP 225).
6. Change the local Scope spot/TWAP to 150 and execute native refresh + Bidwall
   settlement. Verify all payment, delivery, intermediate-account and capacity deltas.
7. Simulate and reject replay of the stale quote. Show an over-budget request
   rejected by the client before signing; no automatic reduction of the request.
8. Move the local scenario clock to expiry, withdraw the unspent escrow and verify
   provider credit, empty escrow and the Withdrawn state.
9. Restore captured lender state and scenario time for a clearly labelled,
   independent capacity case. Create/fund/activate a new bid for exactly the
   measured delivery, with 594.633549 USDC in the verified run. Settle through
   real Kamino; assert Exhausted state, zero escrow and zero remaining quantity.
10. Verify that the client refuses another attempt, and that simulation rejects
    the previously prepared instructions with the exhausted-bid error. No failed
    transaction is submitted. This resets the same captured loan; it does not
    claim a second eligible mainnet loan or a measured market shortfall.

Two fresh runs produced the same money flow:

| Result                                 |                      Amount |
| -------------------------------------- | --------------------------: |
| Provider receives                      | 396,422,366 raw NVDAx atoms |
| Bid consideration                      |             594.633549 USDC |
| Debt repayment                         |             566.377120 USDC |
| Borrower surplus                       |              28.256429 USDC |
| Remaining funds subsequently withdrawn |             905.366451 USDC |

These are local replay results. Raw NVDAx units are not automatically equivalent to
UI-scaled share quantities. The recorded milestone-3 transaction has slightly different
atom-level results; each run verifies its own executed balances and contract rounding.

The demo uses one ephemeral signer for the provider and keeper roles. Separate-party
signers are supported by the typed client; this demo does not demonstrate independent
market-maker participation or keeper compensation.

## Evidence and failure labels

`build/demo/receipt.json` contains the run start time, environment, fixture hash,
lender and Bidwall binary hashes, transaction signatures/slots, simulation logs,
settlement deltas, remaining capacity and overall pass/fail status.
`build/demo/surfpool.log` contains local runtime logs. Both are ignored artifacts.

The receipt distinguishes:

- **confirmed:** a transaction was submitted and confirmed on the local runtime;
- **rejected-in-simulation:** no failed transaction was submitted;
- **rejected-before-signing:** the client refused invalid settlement bounds.

The CLI's rejected actions are preflight demonstrations. The Rust adversarial suite
separately executes failing transactions and checks complete state rollback. The CLI
capacity example demonstrates an insufficient budget, not complete bid exhaustion;
the additional exact-capacity case demonstrates exhaustion through confirmed local
execution. The subsequent attempt is rejected in simulation; the on-chain Rust
tests also submit failing transactions and verify rollback.

## Exact-quantity mainnet comparison

After a passed run, click **Get mainnet quote**. The request is fixed to the verified
NVDAx mint, USDC output, the receipt's delivered raw atoms and 50 bps slippage. The
server verifies input/output identities, ExactIn mode, quantity and output bounds.
No route, request failure and a successful quote remain distinct states.

The console shows output and minimum output, observation time/age, context slot,
route and the Jupiter token-API reference price where available. It explicitly
separates the mainnet price from the local Scope override of 150. This comparison
does not establish superior stressed-market execution or profitable provider terms.

Raw HTTP exchanges are saved under `build/demo/quote-*.json.gz` with SHA-256;
`build/demo/quote.json` ties the summary to the run, bid and exact delivered quantity.
Polling only reads this evidence. A new run hides the old comparison; refresh is
manual. These files, like the receipt, are ignored artifacts.

## Shared code

| Path                          | Responsibility                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `app/generated/bidwall/`      | Codama bindings from the built Anchor IDL; account codecs, instructions and PDA derivation            |
| `app/lib/bidwall/client.ts`   | Prepare bid lifecycle and bounded settlement instructions; derive destinations; account validation    |
| `app/lib/bidwall/units.ts`    | Exact decimal-to-atom conversion and cumulative-floor consideration, using bigint                     |
| `app/lib/bidwall/kamino.ts`   | The fixed public NVDAx/USDC route, native refresh accounts and narrow loan decoder                    |
| `app/lib/bidwall/failures.ts` | Conservative explanations of named program errors; unknown failures remain unknown                    |
| `scripts/demo/`               | Local runtime lifecycle, fixture seeding, scenario control, submission and receipts                   |
| `scripts/kamino-fixture.mjs`  | Derive the capture manifest from exact fixture bytes, binary hashes and the recorded settlement event |

The shared client prepares instructions; it does not operate an autonomous keeper or
promise that a quote will execute. A caller must read current chain state, simulate,
review bounded inputs and inspect confirmation. The console's wallet flow and a live
loan watcher remain to be implemented.

The native route is deliberately version-specific. Vaults, farms and the Scope feed
are fixed to the demonstrated configuration. Multi-reserve loans, referrers and
elevation groups are rejected by the client. Changed routing/schema requires review;
there is no generic arbitrary-lender dispatch or silent fallback.

## Verification and code generation

```sh
npm run anchor-test     # 42 workspace tests and SBF/IDL builds
npm run test:client     # 6 tests, including exact fixture wire/account compatibility
npm run demo:kamino     # fresh offline runtime and complete lifecycle
npm run ci             # web build, lint, formatting, quote/risk/demo tests
npm run codama:bidwall  # regenerate bindings after an IDL change
```

The client tests compare its four refresh/settlement instructions byte-for-byte and
account-for-account with the successful recorded transaction. They also cover precise
amount conversion, rounding, lifecycle/capacity bounds, malformed/foreign account data,
error explanations and fixture/manifest consistency. Generated files are committed;
the Codama PDA name collision is resolved by its generated `settleKaminoLiquidator`
name, whose address is checked against the fixture.

Fresh mainnet observation/capture remains in `spikes/kamino-cpi/`, separately from this
SDK-free offline workflow. Explicit `CAPTURE_FIXTURE=1` now writes both the fixture
and its derived manifest; the offline runner refuses a hash mismatch.

## Runtime assumptions and remaining work

Surfpool 1.3.0 has two relevant quirks. Large program artifacts must be written in
chunks; rewriting its built-in immutable Token-2022 through that path panics, so the
smaller Token-2022 binary uses direct account loading. Also, slot time travel and
block confirmation advance its internal wall clock independently. The runner preserves
the scenario's Clock timestamp between steps while letting slots advance. These are
explicit local simulation controls, not production transaction logic. Oracle price
and timestamp changes and expiry travel are likewise local scenario controls.

All program data, balances, time and oracle overrides stay in the runtime script.
The reusable client contains no cheatcodes. The fresh-fork research SDK's dependency
advisories remain unresolved; they are not dependencies of this new demo/client.

Next: connect a functional Bidwall console to this shared client and show actual
local state and receipts. A live operator workflow still needs state fetching,
quote discovery and wallet integration. The quote observer and read-only risk monitor
are implemented; commercial validation and a longer evidence series remain.
This milestone is not a public deployment or audit.

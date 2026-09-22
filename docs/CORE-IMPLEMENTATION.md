# Bidwall core prototype

The first money-flow milestone implements the canonical brief's funded commitment
and local lender harness. No frontend work or live deployment is included.

## Specification provenance

The requested `docs/RWA-LIQUIDATION-DEPTH*.md` files were absent in the initial
checkout. All three were read from the sibling `../ideation/` directory and copied
here before implementation. They remain the product specification. Their research
links refer to the original ideation repository; raw research was not copied or
revalidated. Evidence figures are not execution results.

## Run

```sh
npm run anchor-test
npm run demo:core
cargo clippy --manifest-path anchor/Cargo.toml -p bidwall --all-targets -- -D warnings
cargo fmt --manifest-path anchor/Cargo.toml --all -- --check
```

`anchor-test` builds SBF binaries and IDLs before running the entire Rust workspace
in LiteSVM. No RPC, wallet file, live signatures, or funded network account is used.
Tests seed local token mints/balances and time, then execute actual Anchor instructions
and SPL Token CPIs. Legacy transactions are used by the existing LiteSVM/SDK test
stack; this does not demonstrate network transaction-v1 compatibility.

Validated toolchain: Anchor CLI 1.2.0, Anchor crates pinned to 1.1.2, Solana build-sbf
3.1.15, platform-tools v1.57, Rust 1.96.0, LiteSVM 0.10.0. The CLI emits a crate-version
mismatch warning; SBF and IDL builds are checked. The explicit `--arch v0` is required
for this LiteSVM setup: the CLI's default SBPF v3 binary failed program loading.
The build script removes inherited AppImage variables because the local AVM launcher
otherwise dispatched to the host application's executable. These are build/runtime
compatibility choices, not transaction versions.

Generated local artifacts: `anchor/target/deploy/bidwall.so` and
`anchor/target/idl/bidwall.json`. The declared program address is a local placeholder,
not a verified deployment address. `--ignore-keys` is for local builds only. The old
`vault` example and its UI/client remain separate, and are not the Bidwall interface.
The Anchor provider defaults to localnet.

## Program and trust boundary

`anchor/programs/bidwall/src/lib.rs` contains one new Anchor program with an embedded
minimal lender harness and one fixed adapter path (`adapter == bidwall::ID`). No
arbitrary CPI target, keeper-selected recipient, mint substitution, or external
adapter registration is accepted. Settlement is restricted to the market's immutable
keeper identity, which must sign. Each market pins its token pair and each bid pins
one market. Dedicated per-bid escrow prevents double allocation across markets.

The harness authority can create modeled outstanding positions by depositing real
local test collateral and declaring debt. It can update its synthetic collateral
mark. This is a deliberate trust boundary: it is not a real lending market, oracle,
loan origination system, or verified proof of external debt. The provider must trust
this test authority. Markets are permissionlessly created named harness instances;
creation does not certify them as approved production lenders.

Harness rules are explicit: full liquidation of a modeled position is eligible when
its debt exceeds 80% of its marked collateral value. The marked value is rounded down
to USDC atoms before this comparison. A bid can fill partially across positions, but
this milestone does not split a single position. Repayment is its entire remaining
debt. There is no liquidation penalty, keeper fee, platform fee, reservation payment,
interest, or close-factor auction. Purchase proceeds above debt go to the stored
borrower, not the keeper. Repaid USDC remains in the harness's debt vault; lender
withdrawal/origination functionality is deliberately outside this thin harness.

## Terms, units, and lifecycle

- USDC test mint: exactly six decimals, classic SPL Token only.
- Collateral test mint: classic SPL Token, at most nine decimals. No Token-2022
  extensions, scaled balances, transfer fees, or real NVDAx support is implied.
  Anchor's initialization macros require the `token_2022` crate feature, but account
  types and the pinned Token program still reject Token-2022-owned accounts.
- Price and mark: USDC atoms per whole collateral token. Quantity: collateral atoms.
  The scale is read from the mint and stored in the immutable market configuration.
- `create_bid`: immutable provider, market/adapter, price, quantity, start and expiry;
  unique provider/id PDA; creates its own escrow; starts Draft.
- `fund_bid`: transfers the entire maximum integer consideration from the provider,
  atomically entering Funded. A failed transfer leaves Draft. No partial funding.
- `activate_bid`: requires Funded and sufficient escrow, enters Active. Activation
  may precede the start timestamp, but settlement cannot. Capacity observers must
  filter state and time; Draft's budget is a requirement, not committed liquidity.
- Settlements are allowed on `[start, expiry)`. Remaining quantity/funds decrease;
  the final fill enters Exhausted. Consumed position state and expected remaining
  capacity guard against replay, including a freshly signed repeat.
- There is no cancel or reprice instruction. Even funded, unactivated bids remain
  locked until expiry. Withdrawal is allowed at `now >= expiry`, including Draft,
  Funded, Active, and Exhausted; it returns the entire actual escrow balance and
  enters Withdrawn. Bid accounts remain to prevent identifier reuse. Expired is
  derived from the clock, not a state requiring a keeper transaction. Historical
  unfilled quantity remains after withdrawal but provides zero available capacity.
- Reservation compensation is explicitly zero for this milestone. Nonzero fee
  agreements require separate funded settlement logic and are not supported.

Budget is `floor(max_quantity * price / scale)` using u128 intermediate arithmetic
and checked conversion to u64. A fill pays the difference of cumulative floor-rounded
consideration before and after it. This bounds total spend by the original budget
regardless of fragmentation; the integer purchase obligation rounds down by less
than one USDC atom overall. Individual fills can differ from exact fractional
consideration by less than one atom. No floats are used. Fills whose proceeds cannot
cover all modeled debt are rejected; no partial debt write-off is hidden.

## Atomic settlement evidence

The instruction checks account relationships, time, state, eligibility, replay and
capacity, then performs three checked token transfers:

1. Bid escrow → pinned lender debt vault: full debt repayment.
2. Bid escrow → borrower-owned USDC account: purchase proceeds minus debt.
3. Position collateral vault → provider-owned collateral account: full seized lot.

It then retires the position debt, consumes bid capacity and emits a `Settlement`
event with position, bid, collateral, debt, proceeds, residual and remaining capacity.
There is no intermediate credit or promised future delivery. Runtime transaction
rollback covers both CPI transfers and all account updates.

The deterministic demo funds 100 units at 97 test USDC/unit (9,700 USDC). A 40-unit
liquidation repays 3,600 USDC, returns 280 to the borrower, and leaves 60 units / 5,820
USDC. A 70-unit liquidation fails unchanged, exposing a 10-unit capacity shortfall.
A 60-unit liquidation then exhausts the bid.

Adversarial tests assert balances and state, including premature withdrawal, failed
funding, missing/incorrect signers, unauthorized price updates, exact start/expiry,
wrong mints/recipients/token program/vaults, wrong market/account owner, reinitialization,
healthy debt, insufficient proceeds, overfill, depletion and replay. The frozen
collateral-destination test observes three transfer attempts and confirms all account
state is unchanged after the last one fails. A second test proves whole-transaction
rollback when settlement succeeds but a later instruction fails. Arithmetic tests
cover bounds and fragmented fills; an SBF test verifies nine-decimal collateral.

## Remaining work and blockers

- Real reserve, liquidation interface, collateral mint ownership/extensions/scaling,
  oracle rules, close factors, penalties and fees have not been verified. No Kamino
  CPI/fork test or issuer token compatibility claim is made. This blocks real-token
  deployment and lender-integration claims, not the local harness milestone.
- Business validation still requires independent provider terms and a named lender
  use case. No outreach, market-maker commitment, or lender approval is implied.
- Quote observer with raw responses and metadata, generated Bidwall client/keeper,
  commitment console, and network demo are next milestones. No research quote has
  been presented as a successfully simulated or executed trade.
- Frozen token accounts or mints can make commitments unexecutable or withdrawals
  fail. Full funding alone does not eliminate issuer authority, price, inventory,
  oracle, keeper availability, expiry, or program-upgrade risk.
- This is unaudited prototype code. Production would need a separately verified
  lender trust boundary, deployment/upgrade governance, token support policy and
  integration tests. Escrow does not establish safe borrowing limits.

## Validation recorded for this milestone

- `npm run anchor-test`: SBF and IDL builds pass; 19 Bidwall tests (including its
  program-ID check) and 4 original vault tests pass.
- Bidwall Clippy with `-D warnings` and workspace Rust formatting pass.
- `npm run build` and `npm run format:check` pass.
- `npm run lint` exits successfully with three existing starter warnings in
  `vault-card.tsx`, `wallet-button.tsx`, and `wallet/signer.ts`. No frontend code was
  changed for this milestone.

The copied briefs received Markdown formatting only. Their product requirements
and evidence caveats have not been changed.

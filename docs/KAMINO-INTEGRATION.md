# Kamino funded-bid integration (milestone 3)

**Demonstrated:** Bidwall settles a funded bid through the deployed Kamino Lending
v2 liquidation interface on a local mainnet fork. A committed offline fixture
replays the real lender, farms and Token-2022 binaries against the current Bidwall
build. **Not demonstrated:** a mainnet Bidwall deployment, production readiness,
arbitrary Kamino markets, or an independently supplied market-maker bid.

For the newer one-command offline lifecycle demo and shared client, see
[OPERATOR-DEMO.md](OPERATOR-DEMO.md).

The older [lender harness](LENDER-ADAPTER.md) and all of its lifecycle/adversarial
checks remain. No frontend integration or polish is part of this milestone.

## Exact target and research

The adapter pins these identities in `instructions/kamino.rs`:

| Role                  | Address                                        |
| --------------------- | ---------------------------------------------- |
| Kamino Lending        | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`  |
| Public xStocks market | `5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua` |
| NVDAx reserve         | `7B66Az3tJhAo4bLkX8PzTixQ9ZGyHkkjxfVLhF26sP5q` |
| USDC reserve          | `97zoywd8mPZsGTg8q1wdD2Wgkdrs2tqusp1Qqcxbyj7E` |
| NVDAx mint            | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh`  |
| USDC mint             | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Kamino Farms          | `FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr` |

The public xStocks market uses a Scope feed for this pair. The separate
Sentora market (`8BNUWRSibVasaAmhYpBCFpGgMisGKfVAf9ho3Cmf6vjr`) has a different
NVDAx reserve and PYUSD debt. The briefs' discussion of that market and its
Chainlink integration is not a description of this adapter's USDC target.

Research used [Kamino's source at a0876097](https://github.com/Kamino-Finance/klend/tree/a08760976f51a3a58c4a0c6ea27b4a0e565bca79/programs/klend/src),
its [v2 liquidation handler](https://github.com/Kamino-Finance/klend/blob/a08760976f51a3a58c4a0c6ea27b4a0e565bca79/programs/klend/src/handlers/handler_liquidate_obligation_and_redeem_reserve_collateral.rs),
the official klend SDK 12.0.0 generated layouts/instructions, and public RPC state.
The older v1 path has a CPI whitelist; **v2 successfully executes through Bidwall**
for this public market. Market permission checks, freshness, close factors, bonus,
protocol fees and farms updates are executed by the real lender.

## Money flow and invariant checks

1. `create_kamino_market` registers only the fixed pair. Existing create/fund/activate
   instructions fully fund and lock the bid. Settlement requires its named keeper,
   active state and `[start, expiry)` window.
2. The keeper places native reserve and obligation refresh instructions before
   `settle_kamino`. The adapter validates lender ownership, exact account lengths,
   discriminators, market, reserves, vaults, authority PDA, farms PDA, token programs,
   mints and recipients. This parser supports one NVDAx deposit and one USDC borrow;
   additional reserves fail closed.
3. `expected_remaining` and `expected_deposited_ctokens` bind the quote to bid and
   loan state. Deposited cTokens are used instead of debt so normal interest accrual
   during refresh does not invalidate the quote. Both values change after a fill;
   a newly signed replay fails. This is state binding, not a permanent loan nonce:
   later eligible partial liquidations with fresh expectations are allowed.
4. Transfer at most `max_repay` from escrow to a separate liquidator PDA's USDC
   account. The lender never receives the bid PDA as signer or escrow authority.
5. Invoke only `liquidate_obligation_and_redeem_reserve_collateral_v2`, with caller
   bounds on repayment and minimum received collateral. The LTV override is always
   zero. Kamino rejects healthy loans, stale prices and stale loan/reserve state.
6. Verify debt decreased by the actual repayment (Kamino rounds fractional debt up
   to a token atom), the repay vault increased by that amount, deposited collateral
   decreased, collateral was delivered, and no newly received cTokens remain.
7. Compute the exact fixed bid consideration using cumulative integer rounding on
   **net delivered collateral after Kamino fees**. Require consideration to cover
   repayment and fit the remaining funds and quantity. Return unused repayment
   budget to escrow; transfer `consideration − repayment` to a USDC account owned
   by the obligation owner; forward NVDAx to the provider.
8. Verify final balance deltas and unchanged intermediate balances, reduce capacity
   once, mark exhaustion if appropriate, and emit the existing settlement event.
   Any failed check or transfer reverts the entire transaction, including native
   lender refresh, repayment, collateral redemption and farms updates.

Kamino itself leaves unseized collateral in the loan and does **not** pay a USDC
residual. The extra borrower payment above is Bidwall's allocation of the fixed
purchase consideration after satisfying Kamino repayment. It does not alter the
lender's bonus, fees or seized amount. It is not called a Kamino-native refund.
The keeper cannot redirect this surplus. A missing/frozen borrower token account
blocks this route; the adapter does not silently retain the surplus.

NVDAx is Token-2022 with 8 decimals and scaled-UI/issuer-control extensions. USDC
uses classic SPL Token with 6 decimals. Quantity is **raw atoms**; price is USDC
atoms per `10^8` raw NVDAx atoms, before any UI multiplier. This is not necessarily
one displayed share. Generic Token-2022 support is not claimed. Changed token
extensions, transfer hooks, fees or issuer freezes can block the route; measured
recipient deltas prevent a successful payment with short delivery.

## Reproducible evidence

The [fixture manifest](../anchor/programs/bidwall/fixtures/manifest.json) records
binary and snapshot SHA-256 hashes. The capture's coherent upstream slot is
`449746339`. Local liquidation signature:
`5jYJJeurK8pPqTpJtFaNYLofPXCDuxJbDWEpaQmSwScoxdt9vFahmrPuboYWfKYK4Fsq5ENk6T2xxaso81RXy1T4`.
This signature is on the local fork, not a mainnet explorer receipt.

The real obligation was healthy at the observed price. The test changed only the
local Scope NVDA spot/TWAP to 150 and refreshed the relevant oracle timestamps;
lender debt, reserve economics and collateral were not fabricated. Test USDC and
empty destination accounts were supplied through Surfpool cheatcodes. Bidwall
market creation, bid creation, funding and activation ran as real instructions.
The complete refresh/settlement transaction consumed 276,869 compute units in the
recorded Surfpool run.

| Flow                        |                      Amount |
| --------------------------- | --------------------------: |
| Provider receives           | 396,422,365 raw NVDAx atoms |
| Fixed bid consideration     |             594.633547 USDC |
| Native debt repayment       |             566.377119 USDC |
| Additional borrower payment |              28.256428 USDC |
| Remaining bid quantity      | 603,577,635 raw NVDAx atoms |
| Remaining bid funds         |             905.366453 USDC |

Run the offline suite (no RPC or wallet required):

```sh
npm run anchor-test   # builds all SBF programs, runs the entire workspace
npm run test:kamino   # builds and runs only the 17 Kamino tests
```

The tests include healthy/stale-oracle/stale-reserve rejection, native minimum
output, wrong programs/markets/reserves/mints/recipients, malformed or foreign loan
accounts, unauthorized keeper, stale bid and loan expectations, overfill, insufficient
price, expiry/state, partial fills, a fresh second liquidation, exhaustion, frozen
borrower payment and frozen provider delivery. Failed-execution tests compare every
captured account before/after; the fee payer alone pays the normal transaction fee.
Post-CPI failures explicitly check that the real lender returned success first.

The original 29 workspace tests continue to cover lifecycle boundaries, withdrawal,
cross-market allocation, direct-spend attempts and a malicious harness upgrade.
The new replay adds 17 tests (46 workspace tests total, including 4 starter `vault`
tests removed on 3 October 2026; 42 remain).

For a fresh network-dependent fork run, follow the [fixture capture instructions](../anchor/programs/bidwall/fixtures/README.md).
The script refuses non-loopback write endpoints. Ordinary runs save ignored evidence;
only `CAPTURE_FIXTURE=1` replaces the checked-in replay. The capture regenerates its manifest from the fixture bytes and settlement event;
review both together after a fixture change. Live obligations and deployed binaries
can change, so a fresh capture can legitimately require new account selection.

## Toolchain and limits

- Anchor CLI/crates 1.1.2, SBF tools v1.52, architecture v0; deterministic public local
  program IDs remain aligned. The adapter uses the existing Bidwall identity.
- Surfpool **1.3.0** was used for this capture. On this version, slot time travel wrote
  a relative slot to Clock; the script restores the absolute slot. It also resumes
  the paused clock briefly to confirm submitted transactions. A coherent batch read
  prevents reserve/vault mismatches from lazy reads at different upstream slots.
- Fork scripts isolate the official lender SDK's Kit 2.3.0 dependencies from the
  frontend. The recorded live transaction uses a v0 message and the lender's lookup
  table, matching this installed runtime/SDK. No v1 transaction claim is made.
- The raw account parser is deliberately narrow and version-sensitive. Schema changes
  should fail closed and require a reviewed update. Multi-reserve obligations,
  permissioned markets, arbitrary farm arrangements and alternate debt assets are not
  demonstrated. The captured loan has no referrer and no elevation group.
- Program identities are pinned; upgrade hashes are **recorded, not enforced on
  chain**. Kamino and token issuer upgrade/control authorities remain trust assumptions.
  A compromised lender able to forge its own debt records and token movements is
  outside the guarantee. Delta checks alone cannot make a compromised lender honest.
- No reproducible source-to-deployed-binary match or independent security audit has
  been performed. The fixture contains the actual captured deployed binaries, not a
  rebuild assumed to match them. See its license notices for non-production use.
- This proves an adapter path on controlled fork/replay state. It does not prove
  production economics, external provider demand, keeper availability, or safety of
  changing lending limits. No mainnet transaction was signed or submitted.

## Verification on 2026-09-23

- `npm run anchor-test`: SBF/IDL builds pass; 46 workspace tests pass.
- `cargo clippy --manifest-path anchor/Cargo.toml --workspace --all-targets -- -D warnings`:
  passes (with AppImage variables removed as in the build scripts).
- `cargo fmt --manifest-path anchor/Cargo.toml --all -- --check`: passes.
- `npm run ci`: web build, lint and format check pass; three existing frontend lint
  warnings remain. The frontend is still the starter, not a Bidwall console.
- `npm ci --prefix spikes/kamino-cpi --ignore-scripts` followed by
  `node spikes/kamino-cpi/scenario.mjs`: fresh fork run passes healthy-loan rejection,
  funded activation, bounded v0 packet size, successful settlement and all balance
  and capacity assertions. Latest local signature:
  `62eenvWN6D52EmtySqsL1gUm4z5Wjdq3zNyWcyPYRBeDr6kx6eUHnnVpnLRzCbG2FBRtqEhyaPDUgJLHtJkiWCu3`.
- `npm audit --prefix spikes/kamino-cpi`: **not clean**. The standalone upstream SDK
  dependency tree reports 20 affected packages (12 high, 8 moderate), including
  transitive advisories in `bigint-buffer`, `toml`, `uuid` and `stream-json`; npm offers
  no fix for this pinned tree. These packages are isolated to the local fork tooling,
  not the Anchor program or its offline replay tests. Do not treat this research SDK
  installation as an approved production keeper stack. Replacing or updating those
  upstream dependencies requires a separate compatibility review.

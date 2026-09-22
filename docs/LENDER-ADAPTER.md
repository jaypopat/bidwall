# Lender-adapter boundary (milestone 2)

Milestone 1 proved escrow accounting and atomic rollback with a lender embedded inside
the Bidwall program. This milestone moves the lender into an independently deployed
program and makes Bidwall settle through that program's own liquidation instruction
via CPI. It supersedes the "Program and trust boundary" and "Atomic settlement
evidence" sections of [CORE-IMPLEMENTATION.md](CORE-IMPLEMENTATION.md). Lifecycle,
terms, units and rounding are unchanged.

**Production support claimed: none.** The lender is a local harness. No Kamino (or any
other protocol) CPI, fork test or deployment has been demonstrated.

## Target lender research: Kamino klend

Source read: `Kamino-Finance/klend` at `a08760976f51a3a58c4a0c6ea27b4a0e565bca79`
(2026-08-18), `programs/klend/src`. Findings, with file references:

- `liquidate_obligation_and_redeem_reserve_collateral` (v1, deprecated) calls
  `check_refresh_ixs!` → `utils::check_refresh`, which returns `CpiDisabled` unless
  the top-level program is in `CPI_WHITELISTED_ACCOUNTS` (`utils/consts.rs`, 16
  entries: Squads, Kamino vaults, Meteora and others). Bidwall is not whitelisted, so
  **v1 cannot be called from Bidwall**.
- `..._v2` (`handler_liquidate_obligation_and_redeem_reserve_collateral.rs`) does not
  call `check_refresh_ixs!` in the handler path read here. It still requires:
  reserves and obligation refreshed in the same slot (`ReserveStale`/`ObligationStale`),
  `check_permissions_and_strip(.., PermissionedOp::LIQUIDATE, ..)` (markets can restrict
  liquidators), farms accounts, a liquidator **signer** that owns the source and
  destination token accounts, cToken redemption, and a protocol fee on redeemed
  liquidity.
- Terms are lender-computed: `calculate_liquidation` applies a debt close factor
  (`liquidation_max_debt_close_factor_pct`), a full-liquidation threshold
  (`min_full_liquidation_value_threshold`) and min/max/bad-debt liquidation bonuses.
  The caller supplies `liquidity_amount` (max repay) and
  `min_acceptable_received_liquidity_amount` (slippage).
- There is no cash residual: the borrower keeps unseized collateral.

Whether v2 can actually be invoked from an unlisted program was not tested. A CPI
guard could exist outside the handler path read here, and v2 still needs the
same-slot refresh instructions in the same transaction. Proving it needs a mainnet
fork test (Surfpool) against the real NVDAx reserve. That test does not exist yet.

## What was built instead

The strongest integration that can be verified locally is an independently deployed
lender with Kamino's interface shape, invoked across a real program boundary.

`anchor/programs/lender_harness`, program `2JHZer7Zz7BKFTdHcnrvqAtPMf7zugw5rGbXT14cUw1N`:

- A lender-owned `Market`, a repay (USDC) and a collateral `Reserve`, each with a supply
  vault owned by a market-authority PDA, and `Position` accounts (modeled loans).
- `liquidate(payment, min_collateral)`: permissionless; a signing liquidator.
  **Lender rule:** eligible when debt exceeds 80% of marked collateral value. Liquidation
  is a full-lot sale: `payment` must be at least the debt. Debt goes to the repay supply,
  `payment − debt` goes to the borrower's USDC account recorded on the position, and the
  whole lot goes to the liquidator's destination. `quote()` is exported so callers can
  pre-check eligibility.
- This rule differs deliberately from Kamino (no close factor, bonus, fee or cToken). It
  is a sale-with-surplus model (similar in spirit to auction liquidations that return
  surplus to the owner). It preserves milestone 1's fixed-price economics and demo numbers.

## Settlement across the boundary

`anchor/programs/bidwall/src/instructions/settle.rs`:

1. **Quote.** Check bid state, time window, replay (`position.settled`,
   `expected_remaining`). Read lender eligibility from lender-owned accounts
   (`lender_harness::quote`). Price the fill at the bid's fixed price with cumulative
   rounding. Require `debt ≤ proceeds ≤ remaining_funds`.
2. **Approve.** The bid PDA (escrow owner) approves a separate, data-less
   `liquidator` PDA (`["liquidator", bid]`) for exactly `proceeds`. The lender never
   receives the escrow owner's signature, so even a malicious lender can move at most
   this fill's proceeds.
3. **Liquidate.** CPI `lender_harness::liquidate(proceeds, lot)` with the liquidator
   PDA as signer, the escrow as source and the provider's collateral account as
   destination.
4. **Verify.** Reload and require exact deltas: escrow −proceeds, repay supply +debt,
   borrower +(proceeds − debt), collateral supply −lot, provider +lot. The allowance
   must be fully consumed (no delegate left), and the position must be settled with
   zero debt/quantity. The four token accounts must be distinct. Any mismatch returns
   `LenderMismatch` (6007) and reverts everything, including the lender's transfers.
5. **Consume.** Reduce remaining quantity/funds, exhaust at zero, emit `Settlement`.

### Pinning (prevents substitution and double allocation)

| Threat                           | Control                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Arbitrary lender program         | `Program<LenderHarness>`; market `has_one = lender_program`; `bid.adapter` pinned at creation                                                          |
| Wrong lender market              | Bidwall market pins one `lender_market` (`has_one`)                                                                                                    |
| Wrong reserve / vault / PDA      | Addresses pinned to `lender_market.repay_reserve`, `.collateral_reserve`, `reserve.supply_vault`; authority PDA derived with `seeds::program` = lender |
| Foreign position                 | `position.market == lender_market`; typed accounts enforce lender ownership (3007) and discriminators                                                  |
| Wrong mints / recipients         | `has_one` mints; provider collateral owner = `bid.provider`; borrower account = `position.borrower_usdc`                                               |
| Unauthorized settlement          | Market's keeper must sign                                                                                                                              |
| Replay / stale capacity          | Lender `settled` flag, Bidwall pre-check, `expected_remaining`                                                                                         |
| Overfill / insufficient proceeds | Lot ≤ remaining quantity; `debt ≤ proceeds ≤ remaining_funds`                                                                                          |
| Payment without delivery         | Post-CPI delta verification + transaction atomicity                                                                                                    |
| Direct escrow spend via lender   | Escrow owner is the bid PDA; the liquidator PDA only signs inside Bidwall                                                                              |
| Double allocation across markets | Each bid pins one Bidwall market, which pins one lender market                                                                                         |

## Evidence (tests)

`anchor/programs/bidwall/src/tests/`, run against the compiled SBF programs in LiteSVM:

- `settlement`: 40/60-unit partial fills with borrower residual (280 USDC), repay supply
  credited, allowance fully consumed, 70-unit capacity shortfall exposed, exhaustion,
  9-decimal collateral, lender threshold and mark authority.
- `rollback`: frozen provider destination (approve + 3 lender transfers observed, all
  reverted), frozen repay supply, frozen borrower account, failing second instruction.
- `substitution`: 15 single-account substitutions, each asserted to its exact Anchor
  error code with no state change, including three non-lender programs in the lender
  slot. Cross-market isolation uses a second genuine lender market registered with the
  same keeper.
- `lender_boundary`:
  - **Compromised lender.** `malicious_lender` is loaded at the lender's address to
    simulate a malicious upgrade. It takes the allowance and delivers nothing; Bidwall
    returns 6007 and all state is unchanged. With verification disabled, this test fails
    (checked by mutation).
  - **Direct spend.** An attacker calling the lender directly cannot spend escrow.
    SPL Token error 4 is returned, and an unsigned liquidator PDA gets 3010.
  - **Competing liquidator.** An independent liquidator can liquidate directly, which
    exercises the lender's slippage bounds. Bidwall then rejects the replay.

`malicious_lender` is a test fixture that deliberately shares the lender's local
identity (see `scripts/local-program-keys.mjs`). It must never be deployed.

## Limitations and next steps

- **Trusted lender program.** The pinned lender program can be upgraded. Delta
  verification bounds the damage, and the allowance caps it at one fill's proceeds, but
  a compromised lender could still deny service. Production needs lender upgrade
  governance, or a pinned program hash.
- **Test authority.** The harness authority seeds debt and sets the mark. No oracle,
  staleness check, interest, close factor, bonus, fee or permissioned liquidation exists.
- **Borrower account.** A frozen or closed borrower USDC account blocks liquidation.
  This is a lender-rule choice that a real lender may handle differently.
- **Kamino.** A real adapter needs Kamino's liquidation-with-redemption flow
  (same-slot refresh instructions, farms and cToken redemption). Collateral would arrive
  in liquidator-owned accounts, so Bidwall would have to forward it to the provider.
  Terms are close-factor/bonus-based with no cash residual, so "fixed price per unit"
  becomes "effective price ≤ bid price". The next step is a Surfpool fork test of v2
  CPI viability against the NVDAx reserve.

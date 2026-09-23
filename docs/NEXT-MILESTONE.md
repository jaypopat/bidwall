# From verified settlement to a usable Bidwall demo

Roadmap · updated 24 September 2026

This document proposes the next implementation sequence. It records recommendations,
not a decision to deploy or accept real funds. The [canonical brief](RWA-LIQUIDATION-DEPTH.md)
remains the scope authority; [Kamino integration evidence](KAMINO-INTEGRATION.md)
records what has actually passed.

## Where we stand

Milestone 4 delivered generated bindings, a shared typed client and a one-command
local demo that funds, settles, demonstrates rejected actions, expires and withdraws
against captured real Kamino binaries. See [the operator demo](OPERATOR-DEMO.md)
and [current component status](STATUS.md).

Step 1 below is substantially delivered for the offline demo. Live state fetching,
opportunity discovery and interactive wallet operation remain. The next implementation
is step 2: the functional console. The quote observer and external validation remain open.

The money-flow test gate for starting a functional interface has been met. The
next milestone should make the proven flow usable and inspectable while preserving
its narrow scope: one public Kamino market, NVDAx/USDC, and the demonstrated loan shape.

## Recommended milestone: an operator can run and explain the complete demo

A person starting from a clean checkout should be able to fund a commitment, inspect
its lock and capacity, attempt a premature withdrawal, execute an eligible liquidation,
inspect all payment legs, demonstrate insufficient capacity, and withdraw remaining
funds after expiry. Every screen must identify the local environment and scenario.

Build in this order, with an atomic commit for each reviewable step.

### 1. Turn the spike into a reusable client and demo runner

- Generate or implement typed Bidwall instruction/account bindings from the current
  IDL; validate addresses and token units at the application boundary.
- Share transaction preparation between the CLI/demo runner and the later console.
  Avoid copying the entire upstream research SDK into the frontend.
- Add ordinary token-account creation instructions for the liquidator, provider and
  borrower destinations. Cheatcodes may seed the initial local scenario; the user
  flow should not require account edits to complete settlement.
- Prepare native reserve/obligation refreshes and the bounded settlement transaction.
  Read current bid and loan expectations, simulate, and explain whether the bid can
  cover the lender's actual repayment and net collateral delivery.
- Keep simulations distinct from confirmed execution. Re-read confirmed account state
  after a fill. A stale quote triggers a fresh read/simulation, not blind resubmission
  or relaxed bounds. Display missing accounts, stale oracle, insufficient price,
  unsupported loan shape and insufficient capacity as separate failure reasons.
- Provide one local start/reset command using pinned state and a fresh-fork command
  for integration checks. Keep generated evidence out of the committed fixture unless
  deliberately refreshing it. Generate the snapshot and its manifest together.
- Export a receipt containing the environment, program/binary identity, bid, loan,
  signature, actual repayment, borrower payment, delivered atoms and remaining capacity.

**Done when:** the complete flow can run from documented commands without editing
addresses or token balances midway through it; reset produces the same scenario;
all existing tests pass; failure receipts show no committed money-flow changes.

This is a manual operator tool first. A continuously running keeper, broad loan
indexer and automatic mainnet submission are separate work.

### 2. Build a small functional console

Three views are enough:

| View       | Essential content and action                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Commitment | Named market, token units, fixed price, quantity, required USDC, start/expiry; create, fund, activate and permitted withdrawal    |
| Capacity   | Active versus future/expired/exhausted commitments; remaining quantity and funds; amount unavailable for the selected liquidation |
| Settlement | Loan/scenario selection, simulation result, bounded execution, confirmed receipt and before/after balances                        |

The UI reads actual local account state. Test funding, locally shocked prices,
recorded replay and any read-only mainnet observations must have distinct labels.
A static screenshot of a passing test is not the interactive settlement flow.

Show why committed funds cannot be withdrawn. Never offer cancel or reprice for
an active commitment. Report capacity at explicit prices and expiries; do not label
it a safe borrowing limit or imply that expired bids cover outstanding loans.

**Done when:** a new user can complete the demo without reading Rust or opening an
RPC console, including a rejected action and a depleted/insufficient-capacity case.
Visual polish follows this functional path.

### 3. Add the quote observer required by the brief

Collect comparison quotes for the **same raw NVDAx amount** delivered in the demo.
Store verified mint addresses, decimals, observation time, context slot where supplied,
route, output, bounded slippage/minimum output, reference price and raw response.

Report the observation's actual environment and time. A current mainnet quote cannot
be presented as a like-for-like stress-price execution against a modified local
oracle. If states differ, show that mismatch explicitly. A quote is an indication;
claim execution only when there is execution evidence. Historical exploratory figures
from the original brief are not the demo's baseline.

**Done when:** an exported quote observation can be inspected and compared without
ambiguity about quantity, units, timestamps or whether it executed.

### 4. Rehearse and freeze the demo

Run the sequence: fund → lock → reject early withdrawal → reject healthy liquidation
→ stress local oracle → settle → inspect repayment/delivery/surplus → show uncovered
capacity → expire → withdraw remaining escrow.

Use a reliable scripted scenario for presentation, retain the real-binary replay tests,
and record a fallback demonstration. Freeze additional markets and features once this
sequence works. Publish the supported scope and the exact evidence with the demo.

## Product questions worth discussing now

### Who pays for the commitment and for execution?

The provider locks purchase capital and accepts price/inventory risk. The keeper
spends transaction fees and operates the liquidation route. In the current settlement,
purchase consideration goes to debt repayment and borrower surplus; there is no
separate keeper reward or implemented reservation-fee flow.

For the hackathon, disclose self-funded purchase capital and operator-paid execution.
For a commercial pilot, obtain concrete answers about who pays a reservation fee,
what term they need, and why a provider prefers this commitment over ordinary
liquidation opportunities. Do not insert a protocol fee or reduce borrower surplus
as an incidental client change: that would change the agreed money flow.

### What exactly is the provider pricing?

On chain, the bid buys raw NVDAx atoms at a fixed price per `10^8` raw atoms.
NVDAx's UI multiplier means this may differ from a displayed share quantity.

Before accepting form input, specify the raw-unit denomination plainly and show any
UI conversion with its observed multiplier/time. Keep raw quantities in receipts.
Changing the contract to promise a fixed price per displayed share would be a new
pricing design, not a cosmetic UI conversion.

### Who should see the first working demo?

Recommended audience: a liquidation operator or lending-market curator, with the
provider funding flow available alongside the operator view. Ask the operator which
actual liquidation decision this helps; ask a provider for indicative price,
quantity, duration, fee and eligibility terms.

These are parallel validation tasks for the founder/team, not completed endorsements
or authorization for automated outreach. One credible use case and one concrete set
of provider terms are more useful than general expressions of interest.

## Gates before accepting real funds

These are separate from hackathon demo completion:

- Independent review of the adapter, account parser, token-extension behavior, recipient
  rules and economic invariants, with the intended deployment configuration.
- A deliberate lender/program upgrade policy. The current implementation pins program
  identities but does not enforce captured binary hashes on chain.
- Reviewed keeper/client dependencies. The standalone fork SDK currently has documented
  transitive advisories; isolation in research tooling is not production remediation.
- Defined keeper authority, signing process, monitoring, retries, fee funding and
  incident behavior. Any recovery mechanism must preserve funded commitment terms.
- Evidence for supported token controls and account-creation paths, including issuer
  freezes and unavailable oracle/market conditions. Do not promise continuous execution.
- Explicit provider terms and buyer/operator expectations, including expiry risk,
  uncovered exposure and any reservation/execution compensation.
- A deployment-specific release plan and bounded initial exposure after those decisions.
  Devnet alone cannot reproduce the mainnet Kamino market used by this adapter.

Do not add multi-asset support, hedging, a safe-borrow-cap model or a second lending
protocol to the next milestone. The immediate deliverable is one inspectable funded
commitment that a person can operate from beginning to end.

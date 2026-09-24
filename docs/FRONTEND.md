# Local operator console

The web interface at `/` now presents the fixed NVDAx/USDC scenario as an operator console. It is an **interactive launcher and receipt viewer** for the already tested offline workflow. Its commitment and capacity figures come from the script's tested terms and the latest exported receipt; they are not a continuously live account feed. The Surfpool runtime stops after each run.

Run `npm run dev:demo` and open <http://127.0.0.1:3000>. Click **Run local scenario** to start a fresh build and replay. The UI polls `/api/demo`, shows progress, then displays the escrow spend, debt repayment, borrower residual, raw NVDAx delivery, capacity at settlement, rejected simulations, local signatures and fixture provenance. Expiry and withdrawal appear in the execution ledger. The receipt and full logs remain in ignored `build/demo/receipt.json` and `build/demo/surfpool.log`.

The action route only works when `BIDWALL_LOCAL_DEMO=1`, in a development build, on the loopback-bound `dev:demo` server. It rejects foreign Host and Origin headers and refuses concurrent runs. It calls the pinned `demo:kamino` command; it never accepts an arbitrary RPC, program ID, address, amount or shell command from the browser. `npm run dev` renders the console with execution disabled.

This is a scripted scenario using one ephemeral signer for provider and keeper, local test funds, a captured public Kamino binary and a locally stressed Scope account. It does not ask for a wallet signature, accept custom bids, watch live obligations, or submit to a public network. The four settlement legs are verified by the runner before a passed receipt is shown. Rejected actions in the browser's ledger are simulations or client-boundary checks; the on-chain adversarial suite separately verifies rollback.

The next functional increment is wallet-driven creation/funding against a persistent local runtime, with account reads and bounded settlement review before signature. That work needs a separate signer/cluster design and should preserve the narrow route and exact raw-unit labels. A quote observer and commercial validation are also outstanding.

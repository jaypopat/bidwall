# Kamino replay fixture

`kamino.json.gz` is a self-contained offline replay fixture, captured on 2026-09-23
from a successful **local Surfpool** transaction. It includes public account state,
Kamino Lending, Kamino Farms and Token-2022 deployed ELF binaries, their SHA-256
hashes, the transaction instructions, clock and provenance. No private keys are
included. The fixture uses locally funded Bidwall escrow and a locally stressed
Scope NVDA spot/TWAP price of 150. It is not a mainnet liquidation.

The lender accounts were fetched together at one upstream RPC context slot. The
provenance records the original oracle prices, modified timestamps, successful
local signature and simulation logs. The offline tests load the current compiled
Bidwall program, rebind the market keeper to an ephemeral signer, and execute the
recorded refresh + settlement instructions against the captured lender binaries.
They never require RPC access or update the fixture automatically.

Generate deliberately after reviewing a fresh fork run:

```sh
npm run anchor-build
npm ci --prefix spikes/kamino-cpi
NO_DNA=1 surfpool start --port 18899 --ws-port 18900 --no-deploy --no-tui --airdrop-amount 0
# In another terminal, from the repository root:
CAPTURE_FIXTURE=1 node spikes/kamino-cpi/scenario.mjs
```

Run offline: `npm run anchor-test`. Public live account discovery can change;
fixture refresh may require selecting another single NVDAx/USDC obligation.
Capture regenerates `manifest.json` from the exact fixture bytes and settlement
event. Keep fixture changes reviewable by recording the new slot, binary hashes
and result in the integration document.

Upstream software retains its own licenses (copies in `licenses/`). The Kamino
binaries are used for non-production testing under their Business Source License;
Token-2022 is Apache-2.0. Source references are
[klend](https://github.com/Kamino-Finance/klend),
[kfarms](https://github.com/Kamino-Finance/kfarms), and
[token-2022](https://github.com/solana-program/token-2022).
The captured deployed binaries have not been reproducibly matched to source builds.

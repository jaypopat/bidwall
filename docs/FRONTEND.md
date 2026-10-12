# Story console

The page at `/` explains committed exit liquidity, then shows a verified local
Kamino liquidation. ONyc/USDC is the default; NVDAx/USDC is also supported.

The main reading path is product → one ONyc sale-size comparison → the measured
settlement → participant incentives. The opening explains the funded buyer in
plain language and links directly to the demo. The comparison keeps the recorded
quote and hypothetical funding requirement visible; formulas are expandable.

The replay opens on settlement. Four compact controls let visitors inspect
funding, a local price shock, settlement and expiry without a forced scrolling
sequence. During an actual local run, the visual follows completed stages and
streams runner output, then returns to the settlement when the run finishes.
The flowing shader keeps a soft ordered-dither texture; the full depth chart, safety checks,
capacity replay and execution ledger live in optional evidence sections.

Run `npm run dev:demo` and open <http://127.0.0.1:3000>. **Run ONyc scenario**
starts a fresh build and offline replay, using captured mainnet state, Kamino's
actual deployed binaries and local test funds. The page polls `/api/demo`, follows
completed story stages, and streams progress. The runner stops its isolated
Surfpool runtime at the end. Execution is enabled only in development with the
local-demo flag, loopback Host and same-origin requests; concurrent runs are
refused. The action accepts only a supported pair identifier.

A hosted or execution-disabled page displays the committed ONyc receipt, clearly
labelled **Recorded run**. It does not launch a runtime or need a wallet. The
first hosted visit opens a dismissible notice explaining the local execution,
test funds and reproduction commands. It is remembered for that tab's session
and can be reopened with **Demo info**. The **Watch the settlement**
link selects and opens the measured money flow; pair selection and execution controls are
available locally. Hosted status is read once; polling stops when execution is
disabled. The execution POST route continues to refuse production requests.

The recorded bid escrows 4,700 USDC for up to 5,000 ONyc at 0.94; one transaction
repays 1,000 USDC of debt, sends 14.065940 USDC surplus to the borrower, and delivers
1,078.793553683 ONyc to the provider. Unspent funds return after expiry.

The size comparison holds the replay's collateral/debt ratio constant and applies
observed Jupiter sale haircuts. It explicitly labels scaled bid funding as
illustrative, not committed capital or an executed large liquidation. **Check on
Jupiter now** calls `/api/depth` for $100k, $1M or $5M of a supported token, sized
from Jupiter's token price. The live reference differs from the recorded oracle
reference; both are labelled. Quotes are cached for a minute and never executed.
No-route responses remain distinct from request failures; an unavailable live
quote leaves the dated snapshot visible. Titan/OnRe and staged sales are other
possible exits, so poor Jupiter depth alone does not establish bad debt.

The shader uses a single animation loop per canvas, pauses offscreen and in hidden
tabs, caches uniform locations and caps its render buffer at approximately 500,000
pixels. Interpolation uses elapsed time, and reduced-motion canvases render once
and redraw on resize or state changes. Shader and money-flow animations respect
reduced-motion preferences; replay stages use short, continuous fade transitions. The narrow console demonstrates settlement and refusal checks, not
independent provider participation, a mainnet deployment, wallet-driven bidding
or a continuously operating keeper.

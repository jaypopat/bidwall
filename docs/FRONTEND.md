# Story console

The page at `/` explains committed exit liquidity, then shows a verified local
Kamino liquidation. ONyc/USDC is the default; NVDAx/USDC is also supported.

The story follows six sections: observed depth, a sale-size comparison, the funded
bid, a four-beat liquidation, rejection checks, and the execution record. The
liquidation beats are funding → local price shock → settlement → expiry. The
money-flow visual reads the receipt; early withdrawal, healthy-loan and stale-fill
rejections appear after settlement, with a separate exact-capacity replay.

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
and can be reopened with **Demo info**. The hosted **Watch verified settlement**
link jumps to the measured money flow; pair selection and execution controls are
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

The shader, dither transitions and money-flow animations respect reduced-motion
preferences. The narrow console demonstrates settlement and refusal checks, not
independent provider participation, a mainnet deployment, wallet-driven bidding
or a continuously operating keeper.

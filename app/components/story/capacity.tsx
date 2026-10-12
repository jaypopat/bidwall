"use client";

import type { DemoReceipt } from "@/app/lib/demo/types";
import { tokens, usd } from "@/app/lib/story/format";
import { useInView } from "./motion";

/** The separate exact-capacity replay: a bid spent to zero, then a refusal. */
export function Capacity({
  depletion,
  symbol,
  decimals,
}: {
  depletion?: DemoReceipt["depletion"];
  symbol: string;
  decimals: number;
}) {
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.4 });
  const play = inView && Boolean(depletion);
  return (
    <div ref={ref} className={`capacity ${play ? "is-playing" : ""}`}>
      <div className="capacity-card">
        <span className="vis-label">1 · Funded exactly</span>
        <strong>{usd(depletion?.fundedUsdcAtoms, 2)}</strong>
        <small>USDC, enough for one liquidation</small>
        <div className="capacity-bar">
          <span className="dither-fill" />
        </div>
      </div>
      <div className="capacity-card">
        <span className="vis-label">2 · Spent to zero</span>
        <strong>{usd(depletion?.remainingFunds, 2)}</strong>
        <small>
          USDC left after buying{" "}
          {tokens(depletion?.deliveredCollateralAtoms, decimals, 2)} {symbol}
        </small>
        <div className="capacity-bar draining">
          <span className="dither-fill" />
        </div>
      </div>
      <div className="capacity-card rejected">
        <span className="vis-label">3 · Next liquidation</span>
        <strong>{usd(depletion?.uncoveredRepayUsdcAtoms, 2)}</strong>
        <small>USDC requested, nothing left to pay it</small>
        <span className="stamp">Refused · bid exhausted</span>
      </div>
      {!depletion && (
        <p className="vis-note capacity-note">
          Run the scenario to see the exhaustion replay.
        </p>
      )}
    </div>
  );
}

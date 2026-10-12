"use client";

import { useState } from "react";
import type { DemoTerms } from "@/app/lib/bidwall/demo-terms";
import { demoBudget } from "@/app/lib/bidwall/demo-terms";
import type { ExitDepth } from "@/app/lib/demo/depth";
import type { DemoReceipt } from "@/app/lib/demo/types";
import {
  DEPTH,
  OBSERVED_AT,
  SALE_SIZES,
  ONRE_ENGINE,
} from "@/app/lib/story/data";
import { liquidationComparison } from "@/app/lib/story/economics";
import { usd } from "@/app/lib/story/format";

const SIZES = [100_000, 1_000_000, 5_000_000] as const;
const onyc = DEPTH.find((s) => s.id === "onyc")!;
const pct = (value: number) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value) < 1 ? Math.abs(value).toFixed(2) : Math.abs(value).toFixed(1)}%`;
const dollars = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

export function Counterfactual({
  demo,
  receipt,
  onWatch,
}: {
  demo: DemoTerms;
  receipt: DemoReceipt;
  onWatch: () => void;
}) {
  const [index, setIndex] = useState(2);
  const [live, setLive] = useState<Record<number, ExitDepth | "loading">>({});
  const size = SIZES[index];
  const observed = live[size];
  const liveQuote =
    observed && observed !== "loading" && observed.status === "ok"
      ? observed
      : undefined;
  const noRoute =
    observed && observed !== "loading" && observed.status === "no-route";
  const lossPct = liveQuote ? liveQuote.impactBps! / 100 : -onyc.impact[index]!;
  const model = liquidationComparison(demo, receipt, size, lossPct);
  if (!model) return null;
  const losesMoney = noRoute || model.dexMarginPct < 0;

  const check = async () => {
    setLive((l) => ({ ...l, [size]: "loading" }));
    try {
      const response = await fetch(`/api/depth?pair=onyc&size=${size}`);
      if (!response.ok) throw new Error("Quote unavailable");
      const depth = (await response.json()) as ExitDepth;
      if (
        depth.symbol !== "ONyc" ||
        depth.sizeUsd !== size ||
        !["ok", "no-route", "error"].includes(depth.status) ||
        !Number.isFinite(Date.parse(depth.observedAt)) ||
        (depth.status === "ok" && !Number.isFinite(depth.impactBps))
      )
        throw new Error("Invalid quote");
      setLive((l) => ({ ...l, [size]: depth }));
    } catch {
      setLive((l) => ({
        ...l,
        [size]: {
          status: "error",
          observedAt: new Date().toISOString(),
          symbol: "ONyc",
          sizeUsd: size,
        },
      }));
    }
  };

  return (
    <div className={`versus ${losesMoney ? "is-broken" : ""}`}>
      <div className="versus-head">
        <span className="vis-label">ONyc sale size · illustration</span>
        <div
          className="size-switch"
          role="group"
          aria-label="Collateral sale size"
        >
          {SALE_SIZES.map((label, i) => (
            <button
              key={label}
              aria-pressed={i === index}
              onClick={() => setIndex(i)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="versus-grid" aria-live="polite">
        <div className="versus-col without">
          <span className="versus-tag">Sell through Jupiter</span>
          <div className="versus-result">
            <span className="vis-label">Quote versus reference value</span>
            <strong>{noRoute ? "No route" : pct(-lossPct)}</strong>
            <p>
              {noRoute
                ? "Jupiter cannot quote this sale. Another exit is needed."
                : losesMoney
                  ? "Sale proceeds do not cover the modeled debt."
                  : "Sale proceeds cover the modeled debt, before costs."}
            </p>
          </div>
          <button
            className="link-button"
            disabled={observed === "loading"}
            onClick={() => void check()}
          >
            {observed === "loading"
              ? "Asking Jupiter…"
              : `Check ${SALE_SIZES[index]} on Jupiter now`}{" "}
            <span aria-hidden>↗</span>
          </button>
          <p className="quote-reference">
            {noRoute
              ? "Live · no route"
              : liveQuote
                ? `Live · ${new Date(liveQuote.observedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC · Jupiter spot reference`
                : `Snapshot · ${OBSERVED_AT} · oracle reference`}
          </p>
          {observed &&
            observed !== "loading" &&
            observed.status === "error" && (
              <p className="versus-note" role="status">
                Live quote unavailable. Showing the dated snapshot.
              </p>
            )}
        </div>
        <div className="versus-col with">
          <span className="versus-tag">A committed buyer</span>
          <div className="versus-result">
            <span className="vis-label">If this capacity is funded</span>
            <strong>
              {model.bidSurplusPct >= 0 ? "Debt covered" : "Price too low"}
            </strong>
          </div>
          <dl>
            <div>
              <dt>Fixed bid price</dt>
              <dd>{usd(demo.price, 2)} USDC / ONyc</dd>
            </div>
            <div>
              <dt>Cash needed at this size</dt>
              <dd>{dollars(model.requiredEscrowUsdc)}</dd>
            </div>
          </dl>
          <a className="link-button" href="#liquidation" onClick={onWatch}>
            See the actual repayment <span aria-hidden>↓</span>
          </a>
        </div>
      </div>
      <div className="versus-foot">
        <p>
          Illustrative funding. Actual replay: {usd(demoBudget(demo), 0)} USDC
          committed, $1,000 of debt repaid.
        </p>
        <details>
          <summary>Quote and model details</summary>
          <dl className="comparison-assumptions">
            <div>
              <dt>Collateral uplift in the replay</dt>
              <dd>{pct(model.collateralUpliftPct)}</dd>
            </div>
            <div>
              <dt>Sale proceeds over debt, before costs</dt>
              <dd>{noRoute ? "Unavailable" : pct(model.dexMarginPct)}</dd>
            </div>
            <div>
              <dt>Borrower surplus at the bid terms</dt>
              <dd>{pct(model.bidSurplusPct)}</dd>
            </div>
          </dl>
          <p>
            The model holds the replay&apos;s collateral uplift constant: (1 +
            uplift) × (1 − sale haircut) − 1. The bid uses $0.94 against the
            replay&apos;s $0.95 oracle price. No large liquidation was executed,
            and no outside provider has committed the scaled funding.
          </p>
          <p>
            Jupiter is one route. Sales can be split, bonuses can change, and{" "}
            <a href={ONRE_ENGINE.url} target="_blank" rel="noreferrer">
              OnRe quotes through Titan
            </a>
            . Poor Jupiter depth alone does not establish bad debt across all
            exits.
          </p>
        </details>
      </div>
    </div>
  );
}

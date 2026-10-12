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
}: {
  demo: DemoTerms;
  receipt: DemoReceipt;
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
        <div>
          <span className="vis-label">
            Illustration · ONyc collateral sale value
          </span>
          <p>Same liquidation margin. Different exit size.</p>
        </div>
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
          <span className="versus-tag">Exit through Jupiter</span>
          <dl>
            <div>
              <dt>Collateral uplift in replay</dt>
              <dd>{pct(model.collateralUpliftPct)}</dd>
            </div>
            <div>
              <dt>
                Quoted sale haircut
                <small>
                  {noRoute
                    ? "live · no route"
                    : liveQuote
                      ? `live · ${new Date(liveQuote.observedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC · vs Jupiter spot`
                      : `snapshot · ${OBSERVED_AT} · vs oracle`}
                </small>
              </dt>
              <dd>{noRoute ? "No route" : pct(-lossPct)}</dd>
            </div>
          </dl>
          <div className="versus-result">
            <span className="vis-label">Proceeds over debt · before costs</span>
            <strong>{noRoute ? "Unavailable" : pct(model.dexMarginPct)}</strong>
            <p>
              {noRoute
                ? "Jupiter cannot quote this sale right now. Another route would be needed."
                : losesMoney
                  ? "This quoted route would not cover the debt under these assumptions. A liquidator would need another exit."
                  : "This quoted route covers the debt under these assumptions, with a margin left before costs."}
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
          {observed &&
            observed !== "loading" &&
            observed.status === "error" && (
              <p className="versus-note" role="status">
                Live quote unavailable. The dated snapshot remains shown.
              </p>
            )}
        </div>
        <div className="versus-col with">
          <span className="versus-tag">Exit through a committed bid</span>
          <dl>
            <div>
              <dt>Illustrative bid price</dt>
              <dd>{usd(demo.price, 2)} USDC / ONyc</dd>
            </div>
            <div>
              <dt>
                Escrow needed at this size
                <small>Scaled funding · not the demo bid</small>
              </dt>
              <dd>{dollars(model.requiredEscrowUsdc)}</dd>
            </div>
          </dl>
          <div className="versus-result">
            <span className="vis-label">If this capacity is funded</span>
            <strong>
              {model.bidSurplusPct >= 0 ? "Debt covered" : "Price too low"}
            </strong>
            <p>
              At these terms, payment covers the liquidated debt with{" "}
              {pct(model.bidSurplusPct)} surplus for the borrower. The provider
              receives ONyc and takes its price and redemption risk.
            </p>
          </div>
          <a className="link-button" href="#liquidation">
            See the actual $1,000 repayment <span aria-hidden>↓</span>
          </a>
        </div>
      </div>
      <div className="versus-foot">
        <p>
          The actual replay funds {usd(demoBudget(demo), 0)} USDC and repays
          $1,000. No provider has committed the scaled amount shown here.
        </p>
        <details>
          <summary>How to read this comparison</summary>
          <p>
            The model holds the replay&apos;s {pct(model.collateralUpliftPct)}{" "}
            collateral uplift constant and applies the observed sale haircut: (1
            + uplift) × (1 − haircut) − 1. The bid side uses $0.94 against the
            replay&apos;s $0.95 oracle value. These are illustrations, not large
            liquidations we executed or a forecast of stress-market quotes.
          </p>
          <p>
            Jupiter is one route. Sales can be split over time, bonuses can
            change, and{" "}
            <a href={ONRE_ENGINE.url} target="_blank" rel="noreferrer">
              OnRe offers issuer-backed quotes through Titan
            </a>
            . A poor Jupiter quote does not establish bad debt across all
            available exits.
          </p>
        </details>
      </div>
    </div>
  );
}

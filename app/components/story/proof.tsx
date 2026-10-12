"use client";

import { useState } from "react";
import type { DemoReceipt, DemoStep } from "@/app/lib/demo/types";
import { integer, short, timestamp, usd } from "@/app/lib/story/format";

export function Ledger({
  receipt,
  running,
}: {
  receipt: DemoReceipt | null;
  running: boolean;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const steps = receipt?.steps ?? [];
  const confirmed = steps.filter((s) => s.status === "confirmed").length;
  const rejected =
    steps.length - confirmed + (receipt?.capacityFailure ? 1 : 0);
  return (
    <div className="ledger">
      <div className="ledger-head">
        <strong>Execution record</strong>
        <span>
          {receipt
            ? `${confirmed} confirmed · ${rejected} blocked as expected`
            : running
              ? "Running…"
              : "No run yet"}
        </span>
      </div>
      {steps.length ? (
        <ol>
          {steps.map((step, index) => (
            <li key={`${step.label}-${index}`}>
              <button
                aria-expanded={open === index}
                onClick={() => setOpen(open === index ? null : index)}
              >
                <span className="ledger-n">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="ledger-label">{step.label}</span>
                <span className={`stage-chip ${chip(step)}`}>
                  {step.status === "confirmed"
                    ? "Confirmed"
                    : "Blocked as expected"}
                </span>
              </button>
              {open === index && <StepDetails step={step} />}
            </li>
          ))}
        </ol>
      ) : (
        <p className="ledger-empty">
          {running
            ? "Executing on a fresh local runtime…"
            : "Run the scenario to record every transaction."}
        </p>
      )}
      {receipt?.capacityFailure && (
        <p className="ledger-capacity">
          <strong>Blocked before signing.</strong> The client refused a request
          for {usd(receipt.capacityFailure.requestedRepay, 2)} USDC when only{" "}
          {usd(receipt.capacityFailure.availableFunds, 2)} USDC remained. No
          transaction was submitted.
        </p>
      )}
    </div>
  );
}

const chip = (step: DemoStep) =>
  step.status === "confirmed" ? "confirmed" : "rejected-in-simulation";

function StepDetails({ step }: { step: DemoStep }) {
  return (
    <div className="ledger-details">
      <p>
        {step.status === "confirmed"
          ? "Confirmed on the isolated local runtime."
          : "Rejected in simulation, as the test intends. No transaction was submitted."}
      </p>
      {step.reason && <p className="ledger-reason">{step.reason}</p>}
      <dl>
        {step.signature && (
          <div>
            <dt>Signature</dt>
            <dd>
              <button
                title="Copy signature"
                onClick={() =>
                  void navigator.clipboard.writeText(step.signature!)
                }
              >
                {short(step.signature)} ⧉
              </button>
            </dd>
          </div>
        )}
        {step.slot && (
          <div>
            <dt>Slot</dt>
            <dd>{step.slot.toLocaleString("en-US")}</dd>
          </div>
        )}
        {step.unitsConsumed && (
          <div>
            <dt>Compute units</dt>
            <dd>{step.unitsConsumed.toLocaleString("en-US")}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function Receipt({ receipt }: { receipt: DemoReceipt | null }) {
  const settlement = receipt?.settlement;
  return (
    <div className="receipt">
      <strong>Receipt</strong>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{receipt?.status ?? "—"}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{timestamp(receipt?.startedAt)}</dd>
        </div>
        <div>
          <dt>Source slot</dt>
          <dd>{receipt?.upstreamSlot.toLocaleString("en-US") ?? "—"}</dd>
        </div>
        <div>
          <dt>Bid</dt>
          <dd title={settlement?.bid}>{short(settlement?.bid)}</dd>
        </div>
        <div>
          <dt>Loan</dt>
          <dd title={settlement?.obligation}>
            {short(settlement?.obligation)}
          </dd>
        </div>
        <div>
          <dt>Delivered (raw)</dt>
          <dd>{integer(settlement?.deliveredCollateralAtoms)}</dd>
        </div>
        <div>
          <dt>Fixture</dt>
          <dd title={receipt?.fixtureSha256}>
            {receipt ? short(receipt.fixtureSha256) : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function QuoteCompare({
  receipt,
  symbol,
  stressedLabel,
  quoting,
  quoteError,
  disabled,
  nowMs,
  onQuote,
}: {
  receipt: DemoReceipt | null;
  symbol: string;
  stressedLabel: string;
  quoting: boolean;
  quoteError?: string;
  disabled: boolean;
  nowMs: number | null;
  onQuote: () => void;
}) {
  const comparison = receipt?.comparison;
  const settlement = receipt?.settlement;
  return (
    <div className="quote">
      <div className="quote-head">
        <div>
          <strong>Versus a DEX, right now</strong>
          <p>
            A live Jupiter sell quote for the exact{" "}
            {integer(settlement?.deliveredCollateralAtoms)} raw {symbol} atoms
            the bid received. An indication only; nothing is executed. Mainnet
            prices differ from the replay&apos;s stressed price of{" "}
            {stressedLabel}.
          </p>
        </div>
        <button
          className="btn-secondary"
          disabled={disabled || quoting}
          onClick={onQuote}
        >
          {quoting
            ? "Requesting…"
            : comparison
              ? "Refresh quote"
              : "Get mainnet quote"}
        </button>
      </div>
      {comparison && (
        <>
          <div className="quote-values">
            <div>
              <span>Bid paid</span>
              <strong>{usd(settlement?.paidUsdcAtoms, 2)} USDC</strong>
            </div>
            <div>
              <span>Jupiter would pay</span>
              <strong>
                {comparison.status === "ok"
                  ? `${usd(comparison.outAmountRaw, 2)} USDC`
                  : comparison.status === "no-route"
                    ? "No route"
                    : "Unavailable"}
              </strong>
            </div>
          </div>
          <p className="quote-meta">
            {timestamp(comparison.observedAt)}
            {nowMs !== null &&
              ` · ${Math.max(0, Math.floor((nowMs - Date.parse(comparison.observedAt)) / 60000))} min old`}
            {comparison.contextSlot &&
              ` · slot ${comparison.contextSlot.toLocaleString("en-US")}`}
            {comparison.routeLabels?.length
              ? ` · ${comparison.routeLabels.join(" → ")}`
              : ""}
            {comparison.status === "ok" &&
              ` · min ${usd(comparison.minOutAmountRaw, 2)} USDC at ${comparison.slippageBps / 100}% slippage`}
          </p>
        </>
      )}
      {quoteError && (
        <p role="alert" className="quote-error">
          {quoteError}
        </p>
      )}
    </div>
  );
}

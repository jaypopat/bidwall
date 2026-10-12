"use client";

import { useCallback, useEffect, useState } from "react";
import { MarketRisk } from "./components/market-risk";
import { DEMO_TERMS, demoBudget } from "./lib/bidwall/demo-terms";
import type {
  DemoPair,
  DemoReceipt,
  DemoResponse,
  DemoStage,
  DemoStep,
} from "./lib/demo/types";

const SCENARIO: {
  id: DemoStage["id"];
  title: string;
  pending: string;
  complete: string;
}[] = [
  {
    id: "funded",
    title: "Fund bid",
    pending: "Create and activate a funded bid.",
    complete: "USDC escrowed and bid activated.",
  },
  {
    id: "locked",
    title: "Test the lock",
    pending: "Try to withdraw before expiry.",
    complete: "Expected rejection: early withdrawal was blocked in simulation.",
  },
  {
    id: "healthy",
    title: "Check eligibility",
    pending: "Attempt a healthy-loan liquidation.",
    complete:
      "Expected rejection: healthy-loan liquidation was blocked in simulation.",
  },
  {
    id: "stressed",
    title: "Stress locally",
    pending: "Apply a local Scope price override.",
    complete: "Scope price lowered locally.",
  },
  {
    id: "settled",
    title: "Settle atomically",
    pending: "Execute an eligible liquidation.",
    complete: "Debt, collateral and surplus verified.",
  },
  {
    id: "withdrawn",
    title: "Expire and return",
    pending: "Withdraw the remainder after expiry.",
    complete: "Unused escrow returned after expiry.",
  },
];

function usd(atoms?: string) {
  if (!atoms) return "—";
  const value = BigInt(atoms);
  return `${(value / 1_000_000n).toLocaleString("en-US")}.${(value % 1_000_000n).toString().padStart(6, "0")}`;
}

/** Raw atoms as a whole-token amount, trailing zeros trimmed. */
function tokens(atoms: bigint | string | undefined, decimals: number) {
  if (atoms === undefined) return "—";
  const value = BigInt(atoms);
  const scale = 10n ** BigInt(decimals);
  const fraction = (value % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${(value / scale).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

function integer(atoms?: string) {
  return atoms ? BigInt(atoms).toLocaleString("en-US") : "—";
}

function short(value?: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-6)}` : "—";
}

function timestamp(value?: string) {
  return value
    ? new Date(value).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      }) + " UTC"
    : "—";
}

function Metric({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
}) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <div className="metric-value">
        {value}
        {unit && <span>{unit}</span>}
      </div>
      {note && <p>{note}</p>}
    </div>
  );
}

function StepDetails({ step }: { step: DemoStep }) {
  return (
    <div className="step-details">
      <p>
        {step.status === "confirmed"
          ? "Confirmed on the isolated local runtime."
          : "Expected rejection · check passed. The simulation blocked this deliberately invalid action. No transaction was submitted."}
      </p>
      {step.reason && <p className="step-reason">{step.reason}</p>}
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
                {short(step.signature)} <span aria-hidden="true">↗</span>
              </button>
            </dd>
          </div>
        )}
        {step.slot && (
          <div>
            <dt>Local slot</dt>
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

export default function Home() {
  const [data, setData] = useState<DemoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestError, setRequestError] = useState<string>();
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string>();
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [nextPair, setNextPair] = useState<DemoPair["id"]>();

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/demo", { cache: "no-store" });
      if (response.status === 403) {
        setData({ enabled: false, running: false, output: [], receipt: null });
        return;
      }
      if (!response.ok) throw new Error(`Demo API returned ${response.status}`);
      setData((await response.json()) as DemoResponse);
      setNowMs(Date.now());
      setRequestError(undefined);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const run = async () => {
    setRequestError(undefined);
    try {
      const response = await fetch("/api/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pair: selectedPair }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.error ?? `Could not start demo (${response.status})`
        );
      }
      setSelectedStep(null);
      setData((await response.json()) as DemoResponse);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    }
  };

  const compareQuote = async () => {
    setQuoting(true);
    setQuoteError(undefined);
    try {
      const response = await fetch("/api/demo/quote", { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not request the quote");
      }
      await refresh();
    } catch (error) {
      setQuoteError(error instanceof Error ? error.message : String(error));
    } finally {
      setQuoting(false);
    }
  };

  const receipt: DemoReceipt | null = data?.receipt ?? null;
  // Shown values follow the receipt's own pair; the selector picks the next run.
  const selectedPair = nextPair ?? receipt?.pair.id ?? "onyc";
  const demo = DEMO_TERMS[receipt?.pair.id ?? selectedPair];
  const { symbol, decimals } = demo.pair;
  const budget = demoBudget(demo);
  const completedStages = new Map(
    receipt?.stages.map((stage) => [stage.id, stage.mode])
  );
  const settlement = receipt?.settlement;
  const commitment = receipt?.commitment;
  const comparison = receipt?.comparison;
  const depletion = receipt?.depletion;
  const steps = receipt?.steps ?? [];
  const confirmed = steps.filter((step) => step.status === "confirmed").length;
  const rejected =
    steps.filter((step) => step.status === "rejected-in-simulation").length +
    (receipt?.capacityFailure ? 1 : 0);
  const usedPercent = Number(
    (BigInt(settlement?.paidUsdcAtoms ?? "0") * 100n) / budget
  );
  const status = data?.running
    ? "Running"
    : receipt?.status === "passed"
      ? "Verified replay"
      : receipt?.status === "failed"
        ? "Failed replay"
        : receipt?.status === "running"
          ? "Incomplete run"
          : "Awaiting run";

  return (
    <div className="app">
      <header className="site-header">
        <div className="header-inner">
          <a href="#top" className="wordmark" aria-label="Bidwall home">
            <span className="wordmark-icon">
              <i />
              <i />
              <i />
            </span>
            bidwall<span className="wordmark-dot">.</span>
          </a>
          <div className="header-right">
            <a className="risk-nav-link" href="#market-risk">
              Market risk
            </a>
            <span className="header-product">Operator console</span>
            <span className="env-badge">
              <span /> LOCAL CONSOLE
            </span>
          </div>
        </div>
      </header>

      <main className="main" id="top">
        <div className="page-intro">
          <div>
            <h1>
              Capital that <span>commits.</span>
            </h1>
            <p className="intro-copy">
              A fully funded {symbol} bid, locked to one Kamino market. Run the
              offline scenario and inspect every settlement leg.
            </p>
            <div className="intro-facts">
              <span>{symbol} / USDC</span>
              <span>Kamino v2</span>
              <span>Fixed-price bid</span>
            </div>
          </div>
          <div className="intro-action">
            <div className="dither-mark" aria-hidden="true">
              <span className="dither-grid" />
              <span className="dither-baseline" />
              <span className="dither-caption">CAPITAL / RESERVED</span>
            </div>
            <div className="pair-select" role="radiogroup" aria-label="Pair">
              {Object.values(DEMO_TERMS).map(({ pair }) => (
                <button
                  key={pair.id}
                  role="radio"
                  aria-checked={selectedPair === pair.id}
                  disabled={data?.running}
                  onClick={() => setNextPair(pair.id)}
                >
                  {pair.symbol} / USDC
                </button>
              ))}
            </div>
            <button
              className="run-button"
              disabled={loading || !data?.enabled || data.running}
              onClick={() => void run()}
            >
              {data?.running
                ? "Running scenario…"
                : receipt
                  ? `Run ${DEMO_TERMS[selectedPair].pair.symbol} scenario`
                  : "Run local scenario"}
              <span aria-hidden="true">↗</span>
            </button>
            <span>
              {data?.enabled
                ? "Fresh runtime · test funds only"
                : "Start with npm run dev:demo"}
            </span>
          </div>
        </div>

        <div className="status-line" role="status">
          <span
            className={`status-indicator ${receipt?.status === "passed" ? "passed" : data?.running ? "running" : ""}`}
          />
          <strong>{status}</strong>
          <span className="status-separator" />
          <span>
            {receipt ? timestamp(receipt.startedAt) : "No local receipt yet"}
          </span>
          <span className="status-right">
            Captured mainnet state · local execution
          </span>
        </div>

        {(requestError || data?.error || receipt?.error) && (
          <div className="error-bar" role="alert">
            {requestError || data?.error || receipt?.error}
          </div>
        )}
        {data?.running && (
          <div className="progress-bar" role="status">
            <span className="progress-spinner" />
            <span>{data.output.at(-1) ?? "Preparing isolated runtime…"}</span>
          </div>
        )}

        <section
          className="section scenario-section"
          aria-labelledby="scenario-title"
        >
          <div className="section-title">
            <div>
              <span className="section-index">SCENARIO</span>
              <h2 id="scenario-title">The proof, in order</h2>
            </div>
            <p>
              {receipt?.status === "passed" && !receipt.stages.length
                ? "This older receipt predates staged evidence. Run a new scenario to see it."
                : "Completed checks appear as the offline run progresses. Local overrides are labeled separately."}
            </p>
          </div>
          <ol className="scenario-grid">
            {SCENARIO.map((item, index) => {
              const mode = completedStages.get(item.id);
              return (
                <li
                  className={`scenario-step ${mode ? "is-complete" : "is-pending"}`}
                  key={item.id}
                >
                  <div className="scenario-step-head">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <span className={`scenario-step-state ${mode ?? ""}`}>
                      {mode === "confirmed"
                        ? "Confirmed"
                        : mode === "rejected-in-simulation"
                          ? "Check passed"
                          : mode === "local-override"
                            ? "Local override"
                            : "Waiting"}
                    </span>
                  </div>
                  <h3>{item.title}</h3>
                  <p>
                    {mode && item.id === "stressed"
                      ? `Scope price changed from ${demo.healthyLabel} to ${demo.stressedLabel} locally.`
                      : mode
                        ? item.complete
                        : item.pending}
                  </p>
                </li>
              );
            })}
          </ol>
          <p className="scenario-note">
            Replay and insufficient-capacity checks appear in the execution
            record below. Expected rejections are passed checks; no transaction
            was submitted for those attempts.
          </p>
        </section>

        <section className="section" id="commitment">
          <div className="section-title">
            <div>
              <span className="section-index">01 / COMMITMENT</span>
              <h2>Fixed bid</h2>
            </div>
            <p>
              Terms are fixed by the local demo; this is a receipt viewer, not a
              live order form.
            </p>
          </div>
          <div className="bid-panel">
            <div className="bid-overview">
              <span className="field-label">MARKET</span>
              <h3>
                {symbol} <span>/</span> USDC
              </h3>
              <p>{demo.market}</p>
              <div className="bid-terms">
                <div>
                  <span>Fixed price</span>
                  <strong>{usd(demo.price.toString())} USDC</strong>
                  <small>
                    per {symbol} ({demo.pair.scale.toLocaleString("en-US")} raw
                    atoms)
                  </small>
                </div>
                <div>
                  <span>Maximum quantity</span>
                  <strong>
                    {tokens(demo.quantity, decimals)} {symbol}
                  </strong>
                  <small>
                    {demo.quantity.toLocaleString("en-US")} raw atoms
                  </small>
                </div>
                <div>
                  <span>Commitment starts</span>
                  <strong className="term-date">
                    {commitment
                      ? timestamp(
                          new Date(
                            Number(commitment.start) * 1000
                          ).toISOString()
                        )
                      : "Awaiting run"}
                  </strong>
                  <small>local scenario clock</small>
                </div>
                <div>
                  <span>Expiry / withdrawal unlocks</span>
                  <strong className="term-date">
                    {commitment
                      ? timestamp(
                          new Date(
                            Number(commitment.expiry) * 1000
                          ).toISOString()
                        )
                      : "Awaiting run"}
                  </strong>
                  <small>
                    one-hour replay window; historical scenario time
                  </small>
                </div>
              </div>
            </div>
            <div className="bid-capacity">
              <div className="capacity-top">
                <span className="field-label">FUNDED CAPITAL</span>
                <span className="funded-chip">FUNDED UPFRONT</span>
              </div>
              <div className="capital-number">
                {usd(budget.toString())} <span>USDC</span>
              </div>
              <div
                className="capacity-track"
                role="img"
                aria-label={
                  settlement
                    ? `${usedPercent}% of original escrow spent in the liquidation`
                    : "Settlement has not run"
                }
              >
                <span style={{ width: `${usedPercent}%` }} />
              </div>
              <div className="capacity-key">
                <span>
                  <i className="key-used" /> Used at settlement{" "}
                  {usd(settlement?.paidUsdcAtoms)} USDC
                </span>
                <span>
                  <i className="key-remaining" /> Remaining{" "}
                  {usd(settlement?.remainingFunds)} USDC
                </span>
              </div>
              <p className="capacity-footnote">
                Remaining funds were withdrawn only after scenario expiry.
                Values above are captured immediately after the liquidation.
              </p>
            </div>
          </div>
          <div className="demo-comparison">
            <div className="comparison-heading">
              <div>
                <span className="field-label">EXTERNAL SELL QUOTE</span>
                <h3>Same delivered quantity</h3>
              </div>
              <button
                className="secondary-button"
                disabled={
                  quoting || data?.running || receipt?.status !== "passed"
                }
                onClick={() => void compareQuote()}
              >
                {quoting
                  ? "Requesting quote…"
                  : comparison
                    ? "Refresh mainnet quote"
                    : "Get mainnet quote"}
              </button>
            </div>
            <p>
              Mainnet Jupiter indication, not executed. The quote uses exactly{" "}
              {integer(settlement?.deliveredCollateralAtoms)} raw {symbol}{" "}
              atoms. Mainnet prices and the replay’s locally stressed Scope
              price of {demo.stressedLabel} differ; these figures do not measure
              a stress-market advantage.
            </p>
            {comparison && (
              <p>
                Mainnet reference:{" "}
                {comparison.referencePriceUsd
                  ? `${comparison.referencePriceUsd} USD per ${symbol}`
                  : "unavailable"}
                . Local Scope reference: {demo.stressedLabel} at settlement. Raw
                quantities are not automatically UI-scaled share quantities.
              </p>
            )}
            {comparison && (
              <>
                <div className="comparison-values">
                  <Metric
                    label="LOCAL BID CONSIDERATION"
                    value={usd(settlement?.paidUsdcAtoms)}
                    unit="USDC"
                    note="Confirmed local replay"
                  />
                  <Metric
                    label="MAINNET SELL QUOTE"
                    value={
                      comparison.status === "ok"
                        ? usd(comparison.outAmountRaw)
                        : "—"
                    }
                    unit="USDC"
                    note={
                      comparison.status === "ok"
                        ? `Minimum ${usd(comparison.minOutAmountRaw)} USDC · ${comparison.slippageBps / 100}% slippage`
                        : comparison.status === "no-route"
                          ? "No route returned; not executed"
                          : "Quote unavailable; not evidence of zero depth"
                    }
                  />
                </div>
                <p className="comparison-meta">
                  Observed {timestamp(comparison.observedAt)} ·{" "}
                  {nowMs === null
                    ? "age unavailable"
                    : `${Math.max(0, Math.floor((nowMs - Date.parse(comparison.observedAt)) / 60000))} minutes old`}{" "}
                  ·{" "}
                  {comparison.contextSlot
                    ? `slot ${comparison.contextSlot.toLocaleString("en-US")}`
                    : "no quote slot"}
                  {comparison.routeLabels?.length
                    ? ` · ${comparison.routeLabels.join(" → ")}`
                    : ""}
                </p>
                <details className="comparison-provenance">
                  <summary>Quote units and raw evidence</summary>
                  <dl>
                    <div>
                      <dt>Input mint / decimals</dt>
                      <dd>
                        {comparison.inputMint} / {comparison.inputDecimals}
                      </dd>
                    </div>
                    <div>
                      <dt>Output mint / decimals</dt>
                      <dd>
                        {comparison.outputMint} / {comparison.outputDecimals}
                      </dd>
                    </div>
                    <div>
                      <dt>Input raw atoms</dt>
                      <dd>{comparison.inAmountRaw}</dd>
                    </div>
                    <div>
                      <dt>Output / minimum atoms</dt>
                      <dd>
                        {comparison.outAmountRaw ?? "—"} /{" "}
                        {comparison.minOutAmountRaw ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Raw file</dt>
                      <dd>build/demo/{comparison.rawPath}</dd>
                    </div>
                    <div>
                      <dt>SHA-256</dt>
                      <dd>{comparison.rawSha256}</dd>
                    </div>
                  </dl>
                </details>
              </>
            )}
            {quoteError && <p role="alert">{quoteError}</p>}
          </div>
        </section>

        <MarketRisk
          remainingUsdcAtoms={settlement?.remainingFunds}
          fundedUsdcAtoms={budget.toString()}
          bidLabel={`${usd(demo.price.toString())} USDC per ${symbol}`}
          symbol={symbol}
        />

        <section className="section" id="settlement">
          <div className="section-title">
            <div>
              <span className="section-index">02 / SETTLEMENT</span>
              <h2>Money flow</h2>
            </div>
            <p>Measured balance changes from the isolated transaction.</p>
          </div>
          <div className="settlement-panel">
            <div className="settlement-summary">
              <div className="summary-head">
                <span className="field-label">ATOMIC SETTLEMENT</span>
                <span className={`result-chip ${settlement ? "settled" : ""}`}>
                  {settlement ? "VERIFIED LOCALLY" : "AWAITING RUN"}
                </span>
              </div>
              <Metric
                label="Purchase consideration"
                value={usd(settlement?.paidUsdcAtoms)}
                unit="USDC"
                note="Debited from the bid escrow"
              />
              <div className="identity-lines">
                <div>
                  <span>Debt repaid to lender</span>
                  <strong>{usd(settlement?.repaidUsdcAtoms)} USDC</strong>
                </div>
                <div>
                  <span>Borrower residual</span>
                  <strong>{usd(settlement?.borrowerUsdcAtoms)} USDC</strong>
                </div>
              </div>
              <p className="identity-note">
                Purchase consideration = lender repayment + borrower residual
              </p>
            </div>
            <div className="delivery-summary">
              <span className="field-label">DELIVERED TO PROVIDER</span>
              <div className="delivery-number">
                {tokens(settlement?.deliveredCollateralAtoms, decimals)}
              </div>
              <div className="delivery-unit">
                {symbol} · {integer(settlement?.deliveredCollateralAtoms)} raw
                atoms
              </div>
              <div className="delivery-divider" />
              <div className="delivery-row">
                <span>Quantity remaining</span>
                <strong>
                  {tokens(settlement?.remainingQuantity, decimals)} {symbol}
                </strong>
              </div>
              <div className="delivery-row">
                <span>Bid address</span>
                <strong title={settlement?.bid}>
                  {short(settlement?.bid)}
                </strong>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="depletion">
          <div className="section-title">
            <div>
              <span className="section-index">CAPACITY / SEPARATE REPLAY</span>
              <h2>A funded bid can run out</h2>
            </div>
            <p>
              The lender fixture is reset for this independent case. It does not
              represent a second observed mainnet liquidation.
            </p>
          </div>
          <div className="depletion-panel">
            <div className="comparison-values">
              <Metric
                label="EXACT-CAPACITY BID FUNDED"
                value={usd(depletion?.fundedUsdcAtoms)}
                unit="USDC"
                note="New bid, funded through normal instructions"
              />
              <Metric
                label="ESCROW AFTER SETTLEMENT"
                value={usd(depletion?.remainingFunds)}
                unit="USDC"
                note={
                  depletion
                    ? "Exhausted · zero quantity remains"
                    : "Awaiting depletion replay"
                }
              />
              <Metric
                label="UNCOVERED REPAYMENT"
                value={usd(depletion?.uncoveredRepayUsdcAtoms)}
                unit="USDC"
                note="Further request at the measured repayment size"
              />
            </div>
            <p>
              {depletion
                ? `The new bid bought ${tokens(depletion.deliveredCollateralAtoms, decimals)} ${symbol} and spent its entire escrow. Another attempt was rejected in simulation because the bid was exhausted; no transaction was submitted. The client also refused to prepare it.`
                : "After the main lifecycle, a new bid funds exactly the measured delivery, executes through real Kamino and verifies zero funds, zero quantity and Exhausted state before testing another attempt."}
            </p>
            {depletion && (
              <p className="comparison-meta">
                Bid {short(depletion.bid)} · expected rejection · check passed
              </p>
            )}
          </div>
        </section>

        <section className="section" id="evidence">
          <div className="section-title">
            <div>
              <span className="section-index">03 / EVIDENCE</span>
              <h2>Execution record</h2>
            </div>
            <p>
              Expected rejections show that the safeguards worked. Confirmed
              entries are transactions executed on the local runtime.
            </p>
          </div>
          <div className="evidence-layout">
            <div className="ledger">
              <div className="ledger-header">
                <span>STEP</span>
                <span>
                  {receipt
                    ? `${confirmed} confirmed · ${rejected} expected rejections passed`
                    : "No receipt"}
                </span>
              </div>
              {steps.length ? (
                steps.map((step, index) => (
                  <div className="ledger-entry" key={`${step.label}-${index}`}>
                    <button
                      className="ledger-button"
                      aria-expanded={selectedStep === index}
                      onClick={() =>
                        setSelectedStep(selectedStep === index ? null : index)
                      }
                    >
                      <span className="step-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="step-label">{step.label}</span>
                      <span
                        className={`step-status ${step.status === "confirmed" ? "confirmed" : "expected-rejection"}`}
                      >
                        {step.status === "confirmed"
                          ? "Confirmed"
                          : "Expected rejection · check passed"}
                      </span>
                      <span className="step-toggle">
                        {selectedStep === index ? "−" : "+"}
                      </span>
                    </button>
                    {selectedStep === index && <StepDetails step={step} />}
                  </div>
                ))
              ) : (
                <div className="ledger-empty">
                  {data?.running
                    ? "Executing local scenario…"
                    : loading
                      ? "Loading receipt…"
                      : "Run the scenario to see its transaction record."}
                </div>
              )}
              {receipt?.capacityFailure && (
                <div className="capacity-rejection">
                  <strong>Expected rejection · check passed</strong>
                  <p>
                    Capacity boundary test: deliberately requested{" "}
                    {usd(
                      (
                        BigInt(receipt.capacityFailure.requestedRepay) -
                        BigInt(receipt.capacityFailure.availableFunds)
                      ).toString()
                    )}{" "}
                    USDC more than the remaining funds. Requested{" "}
                    {usd(receipt.capacityFailure.requestedRepay)} USDC;{" "}
                    {usd(receipt.capacityFailure.availableFunds)} USDC remained.
                    Blocked before signing; no transaction was submitted.
                  </p>
                </div>
              )}
            </div>
            <aside className="receipt-panel">
              <span className="field-label">RECEIPT</span>
              <h3>{receipt ? "Local replay" : "No run yet"}</h3>
              <p>
                Captured Kamino binaries and ephemeral test signers. The local
                runtime stops after the scenario.
              </p>
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
                  <dd>
                    {receipt?.upstreamSlot.toLocaleString("en-US") ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt>Obligation</dt>
                  <dd title={settlement?.obligation}>
                    {short(settlement?.obligation)}
                  </dd>
                </div>
                <div>
                  <dt>Fixture hash</dt>
                  <dd title={receipt?.fixtureSha256}>
                    {receipt ? short(receipt.fixtureSha256) : "—"}
                  </dd>
                </div>
              </dl>
              <p className="receipt-note">
                Local test funds and a locally stressed oracle. No public
                Bidwall deployment or production support claimed.
              </p>
            </aside>
          </div>
        </section>
      </main>
      <footer className="footer">
        <span>Bidwall / local operator demo</span>
        <span>Fixed {symbol}–USDC route · raw token units</span>
      </footer>
    </div>
  );
}

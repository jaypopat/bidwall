"use client";

import { useCallback, useEffect, useState } from "react";
import type {
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
    complete: "Early withdrawal rejected in simulation.",
  },
  {
    id: "healthy",
    title: "Check eligibility",
    pending: "Attempt a healthy-loan liquidation.",
    complete: "Healthy loan rejected in simulation.",
  },
  {
    id: "stressed",
    title: "Stress locally",
    pending: "Apply a local Scope price override.",
    complete: "Scope price changed from 225 to 150 locally.",
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
          : "Rejected in simulation. No transaction submitted."}
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

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/demo", { cache: "no-store" });
      if (response.status === 403) {
        setData({ enabled: false, running: false, output: [], receipt: null });
        return;
      }
      if (!response.ok) throw new Error(`Demo API returned ${response.status}`);
      setData((await response.json()) as DemoResponse);
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
      const response = await fetch("/api/demo", { method: "POST" });
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

  const receipt: DemoReceipt | null = data?.receipt ?? null;
  const completedStages = new Map(
    receipt?.stages.map((stage) => [stage.id, stage.mode])
  );
  const settlement = receipt?.settlement;
  const steps = receipt?.steps ?? [];
  const confirmed = steps.filter((step) => step.status === "confirmed").length;
  const rejected =
    steps.filter((step) => step.status === "rejected-in-simulation").length +
    (receipt?.capacityFailure ? 1 : 0);
  const usedPercent = Number(
    (BigInt(settlement?.paidUsdcAtoms ?? "0") * 100n) / 1_500_000_000n
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
            <span className="header-product">Operator console</span>
            <span className="env-badge">
              <span /> LOCAL / OFFLINE
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
              A fully funded NVDAx bid, locked to one Kamino market. Run the
              offline scenario and inspect every settlement leg.
            </p>
            <div className="intro-facts">
              <span>NVDAx / USDC</span>
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
            <button
              className="run-button"
              disabled={loading || !data?.enabled || data.running}
              onClick={() => void run()}
            >
              {data?.running
                ? "Running scenario…"
                : receipt
                  ? "Run new scenario"
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
                          ? "Rejected in simulation"
                          : mode === "local-override"
                            ? "Local override"
                            : "Waiting"}
                    </span>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{mode ? item.complete : item.pending}</p>
                </li>
              );
            })}
          </ol>
          <p className="scenario-note">
            Replay and insufficient-capacity checks appear in the execution
            record below. Simulated rejections did not submit transactions.
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
                NVDAx <span>/</span> USDC
              </h3>
              <p>Kamino v2 · xStocks market</p>
              <div className="bid-terms">
                <div>
                  <span>Fixed price</span>
                  <strong>150 USDC</strong>
                  <small>per 100,000,000 raw NVDAx atoms</small>
                </div>
                <div>
                  <span>Maximum quantity</span>
                  <strong>1,000,000,000</strong>
                  <small>raw NVDAx atoms</small>
                </div>
              </div>
            </div>
            <div className="bid-capacity">
              <div className="capacity-top">
                <span className="field-label">FUNDED CAPITAL</span>
                <span className="funded-chip">FUNDED UPFRONT</span>
              </div>
              <div className="capital-number">
                1,500.000000 <span>USDC</span>
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
        </section>

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
                {integer(settlement?.deliveredNvdaAtoms)}
              </div>
              <div className="delivery-unit">raw NVDAx atoms</div>
              <div className="delivery-divider" />
              <div className="delivery-row">
                <span>Quantity remaining</span>
                <strong>{integer(settlement?.remainingQuantity)} atoms</strong>
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

        <section className="section" id="evidence">
          <div className="section-title">
            <div>
              <span className="section-index">03 / EVIDENCE</span>
              <h2>Execution record</h2>
            </div>
            <p>
              Simulation rejections are labeled separately from confirmed local
              transactions.
            </p>
          </div>
          <div className="evidence-layout">
            <div className="ledger">
              <div className="ledger-header">
                <span>STEP</span>
                <span>
                  {receipt
                    ? `${confirmed} confirmed · ${rejected} rejected`
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
                        className={`step-status ${step.status === "confirmed" ? "confirmed" : "rejected"}`}
                      >
                        {step.status === "confirmed" ? "Confirmed" : "Rejected"}
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
                  <strong>
                    Insufficient capacity · rejected before signing
                  </strong>
                  <p>
                    Requested {usd(receipt.capacityFailure.requestedRepay)}{" "}
                    USDC; {usd(receipt.capacityFailure.availableFunds)} USDC
                    remained. The request was not reduced automatically.
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
        <span>Fixed NVDAx–USDC route · raw token units</span>
      </footer>
    </div>
  );
}

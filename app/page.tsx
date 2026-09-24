"use client";

import { useCallback, useEffect, useState } from "react";
import type { DemoReceipt, DemoResponse, DemoStep } from "./lib/demo/types";

function usd(atoms?: string) {
  if (!atoms) return "—";
  const n = BigInt(atoms);
  return `${(n / 1_000_000n).toLocaleString("en-US")}.${(n % 1_000_000n).toString().padStart(6, "0")}`;
}
const count = (atoms?: string) =>
  atoms ? BigInt(atoms).toLocaleString("en-US") : "—";
const short = (address?: string) =>
  address ? `${address.slice(0, 6)}…${address.slice(-6)}` : "—";
const moment = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }) + " UTC"
    : "—";

function StepDetails({ step }: { step: DemoStep }) {
  return (
    <div className="step-details">
      <p>
        {step.status === "confirmed"
          ? "Confirmed on the local runtime"
          : "Rejected in simulation · no transaction submitted"}
      </p>
      {step.reason && <p className="step-reason">{step.reason}</p>}
      {step.signature && (
        <div className="detail-pair">
          <span>Signature</span>
          <button
            title="Copy signature"
            onClick={() => void navigator.clipboard.writeText(step.signature!)}
          >
            {short(step.signature)} ↗
          </button>
        </div>
      )}
      {step.slot && (
        <div className="detail-pair">
          <span>Local slot</span>
          <strong>{step.slot.toLocaleString("en-US")}</strong>
        </div>
      )}
      {step.unitsConsumed && (
        <div className="detail-pair">
          <span>Compute units</span>
          <strong>{step.unitsConsumed.toLocaleString("en-US")}</strong>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<DemoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestError, setRequestError] = useState<string>();
  const [selected, setSelected] = useState<number | null>(null);
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
      setSelected(null);
      setData((await response.json()) as DemoResponse);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    }
  };
  const receipt: DemoReceipt | null = data?.receipt ?? null;
  const settlement = receipt?.settlement;
  const usedPercent = Number(
    (BigInt(settlement?.paidUsdcAtoms ?? "0") * 100n) / 1_500_000_000n
  );
  const steps = receipt?.steps ?? [];
  const confirmed = steps.filter((s) => s.status === "confirmed").length;
  const rejected =
    steps.filter((s) => s.status === "rejected-in-simulation").length +
    (receipt?.capacityFailure ? 1 : 0);

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Bidwall home">
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          bidwall<span className="brand-period">.</span>
        </a>
        <nav className="topnav" aria-label="Sections">
          <a href="#commitment">Commitment</a>
          <a href="#settlement">Settlement</a>
          <a href="#evidence">Evidence</a>
        </nav>
        <div className="environment">
          <span className="environment-dot" /> LOCAL REPLAY{" "}
          <span className="environment-divider" /> NVDAx / USDC
        </div>
      </header>
      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span>01 / OPERATOR CONSOLE</span>
              <span>FUNDED LIQUIDATION CAPACITY</span>
            </div>
            <h1>
              Liquidity that
              <br />
              <em>stays put.</em>
            </h1>
            <p className="hero-lede">
              A funded buyer, committed before the liquidation. Inspect the
              lock, execute the eligible route, and trace every atom of
              settlement.
            </p>
            <div className="hero-actions">
              <button
                className="primary-button"
                disabled={loading || !data?.enabled || data.running}
                onClick={() => void run()}
              >
                {data?.running
                  ? "Running local scenario"
                  : receipt
                    ? "Run fresh scenario"
                    : "Run local scenario"}{" "}
                <span aria-hidden="true">↗</span>
              </button>
              <a className="text-link" href="#evidence">
                Explore the proof ↗
              </a>
            </div>
            <p className="hero-caption">
              {data?.enabled
                ? "Fresh offline Surfpool runtime · ephemeral test funds · no personal wallet or public RPC."
                : "Run npm run dev:demo locally to enable execution. No public trading endpoint."}
            </p>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="hero-art-grid" />
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit orbit-three" />
            <div className="hero-art-core">
              <span>B</span>
              <small>
                FUNDED
                <br />
                BY DESIGN
              </small>
            </div>
            <div className="hero-art-label art-label-one">CAPITAL / LOCKED</div>
            <div className="hero-art-label art-label-two">ROUTE / VERIFIED</div>
            <div className="hero-art-label art-label-three">
              SETTLEMENT / ATOMIC
            </div>
            <div className="hero-art-corner">
              BW—001
              <br />
              SOLANA / LOCAL
            </div>
          </div>
        </section>
        <section className="trust-strip" aria-label="Mechanism">
          <div>
            <span className="strip-index">01</span>
            <strong>Funded upfront</strong>
            <span>USDC escrowed before activation</span>
          </div>
          <div>
            <span className="strip-index">02</span>
            <strong>Term-bound</strong>
            <span>No early cancellation or repricing</span>
          </div>
          <div>
            <span className="strip-index">03</span>
            <strong>Atomic delivery</strong>
            <span>Collateral reaches the provider</span>
          </div>
        </section>

        <section className="section commitment" id="commitment">
          <div className="section-heading">
            <div>
              <span className="kicker">THE COMMITMENT</span>
              <h2>Capital with a condition.</h2>
            </div>
            <p>
              One named market. One fixed price. A visible end to the
              obligation.
            </p>
          </div>
          <div className="commitment-grid">
            <article className="commitment-card">
              <div className="card-topline">
                <span className="card-kicker">01 — FIXED BID</span>
                <span className="card-status">
                  <span />{" "}
                  {receipt?.status === "passed"
                    ? "REPLAY COMPLETE"
                    : "LOCAL SCENARIO"}
                </span>
              </div>
              <div className="pair-title">
                NVDAx <span>/</span> USDC
              </div>
              <p className="asset-description">
                Public Kamino v2 xStocks market · captured real program binaries
                · locally controlled oracle scenario
              </p>
              <div className="hairline" />
              <div className="bid-metrics">
                <div>
                  <span>Purchase price</span>
                  <strong>
                    150.00 <small>USDC</small>
                  </strong>
                  <p>per 100,000,000 raw NVDAx atoms</p>
                </div>
                <div>
                  <span>Initial escrow</span>
                  <strong>
                    1,500.00 <small>USDC</small>
                  </strong>
                  <p>fully funded before activation</p>
                </div>
              </div>
              <div className="card-foot">
                <span>MAX QUANTITY</span>
                <strong>1,000,000,000 raw atoms</strong>
              </div>
            </article>
            <article className="capacity-card">
              <div className="card-topline">
                <span className="card-kicker">02 — CAPACITY AT SETTLEMENT</span>
                <span className="tiny-marker">RAW UNITS</span>
              </div>
              <div className="capacity-lead">
                <span>Used by liquidation</span>
                <strong>
                  {usd(settlement?.paidUsdcAtoms)}
                  <small> USDC</small>
                </strong>
              </div>
              <div
                className="capacity-bar"
                role="img"
                aria-label={
                  settlement
                    ? `${usedPercent}% of initial escrow used at settlement`
                    : "No settlement receipt yet"
                }
              >
                <span style={{ width: `${usedPercent}%` }} />
              </div>
              <div className="capacity-scale">
                <span>0</span>
                <span>1,500 USDC escrow</span>
              </div>
              <div className="capacity-row">
                <div>
                  <span>Remaining at settlement</span>
                  <strong>
                    {usd(settlement?.remainingFunds)} <small>USDC</small>
                  </strong>
                </div>
                <div>
                  <span>Remaining quantity</span>
                  <strong>
                    {count(settlement?.remainingQuantity)} <small>atoms</small>
                  </strong>
                </div>
              </div>
              <p className="capacity-note">
                {receipt?.status === "passed"
                  ? "The remaining USDC was withdrawn only after scenario expiry. This card shows capacity immediately after the fill."
                  : "Capacity appears after a completed local run. Unused funds are withdrawn after scenario expiry."}
              </p>
            </article>
          </div>
        </section>

        <section className="section mechanism">
          <div className="section-heading">
            <div>
              <span className="kicker">HOW IT CLOSES</span>
              <h2>Four steps. One promise.</h2>
            </div>
            <p>
              The payment and collateral legs must complete together or the
              transaction rolls back.
            </p>
          </div>
          <div className="flow-grid">
            {[
              ["01", "Commit", "Capital is escrowed at a fixed price."],
              ["02", "Qualify", "Lender eligibility is checked."],
              ["03", "Settle", "Debt and collateral move atomically."],
              ["04", "Release", "Unused funds unlock after expiry."],
            ].map(([number, name, detail]) => (
              <div className="flow-step" key={number}>
                <span className="flow-number">{number}</span>
                <div className="flow-symbol">
                  {number === "01" ? "↘" : number === "04" ? "↗" : "→"}
                </div>
                <h3>{name}</h3>
                <p>{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="settlement-panel" id="settlement">
          <div className="settlement-head">
            <div>
              <span className="kicker">THE SETTLEMENT</span>
              <h2>Follow the money.</h2>
              <p>
                Observed balance changes from the local transaction. Figures are
                raw on-chain accounting, not estimated proceeds.
              </p>
            </div>
            <span className={`outcome-pill ${settlement ? "positive" : ""}`}>
              {settlement ? "● VERIFIED LOCALLY" : "○ AWAITING RUN"}
            </span>
          </div>
          <div className="money-grid">
            {[
              [
                "01 / ESCROW",
                "Purchase consideration",
                usd(settlement?.paidUsdcAtoms),
                "USDC",
                "Debited from the funded bid",
              ],
              [
                "02 / LENDER",
                "Debt repaid",
                usd(settlement?.repaidUsdcAtoms),
                "USDC",
                "Delivered to Kamino repay reserve",
              ],
              [
                "03 / BORROWER",
                "Residual paid",
                usd(settlement?.borrowerUsdcAtoms),
                "USDC",
                "Surplus from bid consideration",
              ],
              [
                "04 / PROVIDER",
                "Collateral received",
                count(settlement?.deliveredNvdaAtoms),
                "atoms",
                "Raw NVDAx delivered atomically",
              ],
            ].map(([index, label, value, unit, description], i) => (
              <div
                className={`money-cell ${i === 3 ? "accent-cell" : ""}`}
                key={index}
              >
                <span className="money-index">{index}</span>
                <span className="money-label">{label}</span>
                <strong>
                  {value} <small>{unit}</small>
                </strong>
                <p>{description}</p>
              </div>
            ))}
          </div>
          <div className="settlement-footer">
            <span>PAYMENT IDENTITY</span>
            <strong>Consideration = debt repayment + borrower residual</strong>
            <span className="equality">
              {settlement
                ? `${usd(settlement.paidUsdcAtoms)} = ${usd(settlement.repaidUsdcAtoms)} + ${usd(settlement.borrowerUsdcAtoms)}`
                : "Awaiting local execution"}
            </span>
          </div>
        </section>

        <section className="section evidence" id="evidence">
          <div className="section-heading">
            <div>
              <span className="kicker">EXECUTION RECORD</span>
              <h2>Evidence, not a promise.</h2>
            </div>
            <p>
              Confirmed steps and rejected simulations remain distinct. Select a
              row to inspect the local signature, slot and failure reason.
            </p>
          </div>
          <div className="evidence-grid">
            <div className="ledger">
              <div className="ledger-head">
                <span>SCENARIO LEDGER</span>
                <span>
                  {receipt
                    ? `${confirmed} CONFIRMED · ${rejected} REJECTED`
                    : "NO RECEIPT"}
                </span>
              </div>
              {steps.length ? (
                steps.map((step, index) => (
                  <div className="ledger-item" key={`${step.label}-${index}`}>
                    <button
                      className="ledger-row"
                      aria-expanded={selected === index}
                      onClick={() =>
                        setSelected(selected === index ? null : index)
                      }
                    >
                      <span className="ledger-index">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="ledger-name">{step.label}</span>
                      <span
                        className={`ledger-state ${step.status === "confirmed" ? "is-confirmed" : "is-rejected"}`}
                      >
                        {step.status === "confirmed" ? "CONFIRMED" : "REJECTED"}
                      </span>
                      <span className="ledger-chevron">
                        {selected === index ? "−" : "+"}
                      </span>
                    </button>
                    {selected === index && <StepDetails step={step} />}
                  </div>
                ))
              ) : (
                <div className="empty-ledger">
                  {data?.running
                    ? "Building and executing the local scenario…"
                    : loading
                      ? "Loading receipt…"
                      : "No local receipt yet. Run the scenario to populate this ledger."}
                </div>
              )}
              {receipt?.capacityFailure && (
                <div className="capacity-rejection">
                  <span>CAPACITY CHECK / REJECTED BEFORE SIGNING</span>
                  <p>
                    Requested {usd(receipt.capacityFailure.requestedRepay)} USDC
                    against {usd(receipt.capacityFailure.availableFunds)} USDC
                    remaining. The client refused to relax the bound.
                  </p>
                </div>
              )}
            </div>
            <aside className="record-card">
              <div className="record-top">
                <span>RECORD / {receipt ? "01" : "—"}</span>
                <span className="record-symbol">↗</span>
              </div>
              <h3>
                {receipt?.status === "passed"
                  ? "Verified local replay"
                  : data?.running
                    ? "Scenario in progress"
                    : "Ready to verify"}
              </h3>
              <p>
                {receipt
                  ? "Captured Kamino binaries, a fresh local Bidwall build, and ephemeral test signers. The Surfpool runtime stops after the scenario."
                  : "Execute the local scenario to see confirmed signatures and a complete settlement receipt."}
              </p>
              <dl>
                <div>
                  <dt>Environment</dt>
                  <dd>Offline Surfpool</dd>
                </div>
                <div>
                  <dt>Observed</dt>
                  <dd>{moment(receipt?.startedAt)}</dd>
                </div>
                <div>
                  <dt>Source slot</dt>
                  <dd>
                    {receipt?.upstreamSlot.toLocaleString("en-US") ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt>Bid</dt>
                  <dd title={settlement?.bid}>{short(settlement?.bid)}</dd>
                </div>
                <div>
                  <dt>Obligation</dt>
                  <dd title={settlement?.obligation}>
                    {short(settlement?.obligation)}
                  </dd>
                </div>
                <div>
                  <dt>Fixture SHA-256</dt>
                  <dd title={receipt?.fixtureSha256}>
                    {receipt?.fixtureSha256
                      ? receipt.fixtureSha256.slice(0, 14) + "…"
                      : "—"}
                  </dd>
                </div>
              </dl>
              <p className="record-disclaimer">
                Local test funds · locally stressed oracle · no public Bidwall
                deployment or production protocol support claimed.
              </p>
            </aside>
          </div>
          {(data?.running || data?.error || requestError || receipt?.error) && (
            <div className="run-status" role="status">
              <strong>{data?.running ? "RUNNING" : "RUN STATUS"}</strong>
              <div>
                {requestError ||
                  data?.error ||
                  receipt?.error ||
                  data?.output.slice(-3).join(" · ")}
              </div>
            </div>
          )}
        </section>
      </main>
      <footer className="footer">
        <div className="footer-brand">
          bidwall<span>.</span>
        </div>
        <p>Funded capacity for the moments liquidity matters.</p>
        <span>ONE MARKET · ONE ROUTE · ONE PROOF</span>
      </footer>
    </div>
  );
}

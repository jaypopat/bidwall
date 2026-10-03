"use client";

import { useState } from "react";
import type { RiskSnapshot } from "@/scripts/risk/snapshot";

function dollars(value: string | null) {
  if (value === null) return "Unknown";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: Number(value) < 1000 ? 2 : 0,
  }).format(Number(value));
}
function clock(value: string) {
  return (
    new Date(value).toLocaleString("en-GB", {
      timeZone: "UTC",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }) + " UTC"
  );
}
function quoteAge(seconds: number | null) {
  if (seconds === null) return "No quote evidence";
  if (seconds < 60) return `${seconds}s old`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m old`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m old`;
}

export function MarketRisk({
  remainingUsdcAtoms,
}: {
  remainingUsdcAtoms?: string;
}) {
  const [snapshot, setSnapshot] = useState<RiskSnapshot | null>(null);
  const [scenarioId, setScenarioId] = useState("all-20");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scenario =
    snapshot?.scenarios.find((s) => s.id === scenarioId) ??
    snapshot?.scenarios[0];
  const excluded =
    snapshot?.loansNotModelled.reduce((sum, row) => sum + row.count, 0) ?? 0;

  async function scan() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/risk", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? `Scan failed (${response.status})`);
      setSnapshot(body as RiskSnapshot);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      className="section risk-section"
      id="market-risk"
      aria-labelledby="risk-title"
    >
      <div className="section-title">
        <div>
          <span className="section-index">MARKET / MAINNET</span>
          <h2 id="risk-title">Market risk</h2>
        </div>
        <p>
          Stress the loans. Measure the collateral a first liquidation could
          release against observed DEX exit depth.
        </p>
      </div>
      <div className="risk-toolbar">
        <label htmlFor="risk-scenario">
          Price scenario
          <select
            id="risk-scenario"
            value={scenarioId}
            onChange={(event) => setScenarioId(event.target.value)}
            disabled={!snapshot}
          >
            {snapshot ? (
              snapshot.scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))
            ) : (
              <option value="all-20">All xStocks −20%</option>
            )}
          </select>
        </label>
        <button
          className="run-button risk-scan"
          disabled={loading}
          onClick={() => void scan()}
        >
          {loading
            ? "Scanning mainnet…"
            : snapshot
              ? "Scan again"
              : "Scan market"}
          <span aria-hidden="true">↗</span>
        </button>
      </div>
      {error && (
        <div className="error-bar" role="alert">
          {error}
          {snapshot && " Showing the previous successful snapshot below."}
        </div>
      )}
      <div className="risk-source" role="status" aria-live="polite">
        {loading ? (
          <>
            <span className="progress-spinner" /> Reading the public Kamino
            xStocks market…
          </>
        ) : snapshot ? (
          <>
            <span className="risk-mainnet-dot" />
            {clock(snapshot.observedAt)}
            <span>Loans at slot {snapshot.slot.toLocaleString("en-US")}</span>
            <span>
              Reserves at {snapshot.reserveSlot.toLocaleString("en-US")}
            </span>
            <span>
              {snapshot.loansModelled.toLocaleString("en-US")} /{" "}
              {snapshot.loansRead.toLocaleString("en-US")} loans modelled
            </span>
          </>
        ) : (
          "On-demand mainnet read · estimates only · no transaction"
        )}
      </div>
      {snapshot &&
        (snapshot.quoteIssue ||
          excluded > 0 ||
          snapshot.marketConfig.emergencyMode ||
          snapshot.marketConfig.priceLiquidationDisabled) && (
          <div className="risk-notice">
            {snapshot.quoteIssue && <p>{snapshot.quoteIssue}.</p>}
            {excluded > 0 && (
              <p>
                {excluded} loans excluded:{" "}
                {snapshot.loansNotModelled
                  .map((r) => `${r.reason} (${r.count})`)
                  .join(", ")}
                .
              </p>
            )}
            {(snapshot.marketConfig.emergencyMode ||
              snapshot.marketConfig.priceLiquidationDisabled) && (
              <p>
                Price-triggered liquidation is disabled by the market
                configuration; these scenarios release no collateral.
              </p>
            )}
          </div>
        )}
      <div className="risk-overview">
        <div className="risk-summary">
          <div className="metric">
            <span className="metric-label">Liquidatable loans</span>
            <div className="metric-value">
              {scenario?.liquidatableLoans.toLocaleString("en-US") ?? "—"}
            </div>
            <p>{scenario?.label ?? "Select a scenario after scanning"}</p>
          </div>
          <div className="metric">
            <span className="metric-label">Debt in those loans</span>
            <div className="metric-value">
              {scenario ? dollars(scenario.liquidatableDebtUsd) : "—"}
            </div>
            <p>Counted once per loan</p>
          </div>
          <div className="metric">
            <span className="metric-label">Estimated release</span>
            <div className="metric-value">
              {scenario ? dollars(scenario.releasedUsd) : "—"}
            </div>
            <p>First liquidation · shocked oracle value</p>
          </div>
        </div>
        <aside className="risk-demo-capacity">
          <span className="field-label">LOCAL DEMO / NVDAx ONLY</span>
          <strong>
            {remainingUsdcAtoms
              ? dollars((Number(remainingUsdcAtoms) / 1_000_000).toFixed(6))
              : "$1,500"}
            <span>USDC</span>
          </strong>
          <p>
            {remainingUsdcAtoms
              ? "Captured remaining escrow after settlement"
              : "Original funded commitment"}{" "}
            · fixed bid at 150 USDC per NVDAx. Local test funds; no mainnet
            capacity.
          </p>
        </aside>
      </div>
      {scenario ? (
        <div className="risk-table-scroll">
          <table className="risk-table">
            <caption>
              Collateral release and exit depth under {scenario.label}
            </caption>
            <thead>
              <tr>
                <th scope="col">Collateral</th>
                <th scope="col">Loans</th>
                <th scope="col">Loan debt</th>
                <th scope="col">Released</th>
                <th scope="col">DEX absorbs</th>
                <th scope="col">Shortfall</th>
              </tr>
            </thead>
            <tbody>
              {scenario.rows.map((row) => (
                <tr key={row.mint}>
                  <th scope="row" title={row.mint}>
                    <strong>
                      {row.symbol.length > 12
                        ? `${row.symbol.slice(0, 6)}…${row.symbol.slice(-4)}`
                        : row.symbol}
                    </strong>
                    <small>
                      {(row.minBonusBps / 100).toFixed(0)}% minimum bonus
                    </small>
                  </th>
                  <td>{row.loans.toLocaleString("en-US")}</td>
                  <td>{dollars(row.liquidatableDebtUsd)}</td>
                  <td title={`${row.releasedAtoms} raw atoms`}>
                    {dollars(row.releasedUsd)}
                  </td>
                  <td
                    className={row.absorbableUsd === null ? "risk-unknown" : ""}
                    title={
                      row.absorbableAtoms === null
                        ? "No usable quote ladder"
                        : `${row.absorbableAtoms} raw atoms at the stressed oracle price`
                    }
                  >
                    {row.absorbableIsLowerBound &&
                      row.absorbableUsd !== null &&
                      "≥ "}
                    {dollars(row.absorbableUsd)}
                  </td>
                  <td
                    className={
                      row.shortfallUsd === null
                        ? "risk-unknown"
                        : Number(row.shortfallUsd) > 0
                          ? "risk-shortfall"
                          : ""
                    }
                  >
                    {row.shortfallIsUpperBound &&
                      row.shortfallUsd !== null &&
                      "≤ "}
                    {dollars(row.shortfallUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="risk-empty">
          <span className="field-label">THE CAPACITY GAP</span>
          <h3>How much collateral meets how much liquidity?</h3>
          <p>
            Scan to compare each xStock’s estimated release with the latest
            recorded Jupiter sell ladder. Debt and liquidation limits come from
            Kamino’s on-chain accounts.
          </p>
        </div>
      )}
      <div className="risk-footnotes">
        <p
          className={
            snapshot?.quoteAgeSeconds !== null &&
            (snapshot?.quoteAgeSeconds ?? 0) > 7200
              ? "risk-stale"
              : ""
          }
        >
          <strong>
            {snapshot
              ? `Quote evidence: ${quoteAge(snapshot.quoteAgeSeconds)}.`
              : "Quote evidence is joined when you scan."}
          </strong>
          {snapshot?.quoteObservedAt &&
            ` Recorded ${clock(snapshot.quoteObservedAt)}.`}{" "}
          Scanning refreshes loans; the quote ladder comes from the separate
          observer.
        </p>
        <p>
          ≥ marks a lower bound on depth; ≤ marks the corresponding upper bound
          on shortfall. An interpolated crossing is an estimate. A loan holding
          multiple assets appears under each; per-asset debt and loan counts
          cannot be added.
        </p>
        <details>
          <summary>Model assumptions and limits</summary>
          <p>
            Debt is as of each loan’s last refresh. The first repayment uses the
            market’s {snapshot?.marketConfig.closeFactorPct ?? 20}% close
            factor, rising to 100% above its{" "}
            {snapshot?.marketConfig.insolvencyLtvPct ?? 95}% adjusted LTV
            threshold, with a{" "}
            {dollars(snapshot?.marketConfig.maxRepayUsd ?? "1000000")} cap and
            full repayment of small debt legs. Repayment selects the
            highest-borrow-factor debt asset, then the largest debt among ties.
          </p>
          <p>
            Release is split across collateral in proportion to its shocked
            value, using minimum configured bonuses. This does not reproduce
            Kamino’s collateral priority, dynamic bonus, fees or repeated
            liquidations. Elevation groups are excluded. Debt interest since
            refresh and oracle refresh are not simulated. Oracle prices are the
            values stored in reserves and may be stale.
          </p>
          <p>
            DEX depth uses deviations from Jupiter’s reference price with the
            current quote curve held fixed in token units. Both release and
            capacity are valued at shocked Kamino oracle prices. This is a
            stress comparison, not a forecast of quotes after a price fall or a
            guarantee of execution.
          </p>
        </details>
      </div>
    </section>
  );
}

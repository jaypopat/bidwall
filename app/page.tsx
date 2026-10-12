"use client";

import { useCallback, useEffect, useState } from "react";
import { Counterfactual } from "./components/story/counterfactual";
import { DepthChart } from "./components/story/depth-chart";
import { DemoNotice } from "./components/story/demo-notice";
import { Liquidation, type StoryBeat } from "./components/story/liquidation";
import { LiquidityField } from "./components/story/liquidity-field";
import { Reveal } from "./components/story/motion";
import { Ledger, Receipt } from "./components/story/proof";
import { Trust } from "./components/story/trust";
import { DEMO_TERMS } from "./lib/bidwall/demo-terms";
import type { DemoPair, DemoReceipt, DemoResponse } from "./lib/demo/types";
import { usd } from "./lib/story/format";
import { ONRE_ENGINE, RWA_DEBT, OBSERVED_AT } from "./lib/story/data";
import { RECORDED_RECEIPT } from "./lib/story/recorded";

const NAV = [
  ["problem", "Why it matters"],
  ["liquidation", "The demo"],
  ["proof", "Evidence"],
] as const;

export default function Home() {
  const [data, setData] = useState<DemoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestError, setRequestError] = useState<string>();
  const [nextPair, setNextPair] = useState<DemoPair["id"]>();
  const [view, setView] = useState<StoryBeat>("settled");

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
    if (data?.enabled === false) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh, data?.enabled]);

  const live = data?.receipt ?? null;
  // Without a local runtime (or before the first run) show the recorded run.
  const recorded = !live && !data?.running && !loading;
  const receipt: DemoReceipt | null =
    live ?? (recorded ? RECORDED_RECEIPT : null);
  // Shown values follow the receipt's own pair; the selector picks the next run.
  const selectedPair = nextPair ?? receipt?.pair.id ?? "onyc";
  const demo = DEMO_TERMS[receipt?.pair.id ?? selectedPair];
  const { symbol } = demo.pair;
  const settlement = receipt?.settlement;
  const running = Boolean(data?.running);
  // The counterfactual is about ONyc: use this run if it is one, else the recording.
  const onycReceipt =
    receipt?.pair.id === "onyc" && receipt.status === "passed"
      ? receipt
      : RECORDED_RECEIPT;

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
      setData((await response.json()) as DemoResponse);
      setView("settled");
      document
        .getElementById("liquidation")
        ?.scrollIntoView({ behavior: "smooth" });
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    }
  };

  const status = running
    ? "Running live"
    : recorded
      ? "Recorded run"
      : receipt?.status === "passed"
        ? "Receipt verified"
        : receipt?.status === "failed"
          ? "Run failed"
          : "No run yet";
  const error = requestError || data?.error || receipt?.error;
  const watch = () => setView("settled");

  return (
    <div className="story">
      <header className="story-nav">
        <a href="#top" className="brand" aria-label="Bidwall home">
          <span className="brand-mark" aria-hidden />
          Bidwall
        </a>
        <nav>
          {NAV.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              onClick={id === "liquidation" ? watch : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
        <DemoNotice hosted={data?.enabled === false} />
        <span
          className={`status-pill ${running ? "running" : (receipt?.status ?? "")}`}
          role="status"
        >
          <i /> {status}
        </span>
        {running && (
          <span className="nav-progress">
            {data?.output.at(-1) ?? "Preparing isolated runtime…"}
          </span>
        )}
      </header>

      <main id="top">
        <section className="hero" id="intro">
          <LiquidityField fracture={1} className="hero-field" />
          <div className="hero-inner">
            <span className="kicker">Bidwall · committed exit liquidity</span>
            <h1>
              A buyer in place <em>before</em> a loan goes bad.
            </h1>
            <p className="lead">
              Credit funds lock cash to buy a loan&apos;s collateral. When
              Kamino liquidates, that cash repays the lender in one transaction.
            </p>
            <div className="hero-actions">
              <a className="btn-primary" href="#liquidation" onClick={watch}>
                Watch the settlement <span aria-hidden>→</span>
              </a>
              <a className="hero-secondary" href="#problem">
                Why it matters <span aria-hidden>↓</span>
              </a>
            </div>
            <p className="hero-source">
              Prototype · local execution · test funds
            </p>
          </div>
        </section>

        <section className="band" id="problem">
          <Reveal as="h2">
            <span className="kicker">01 · The need</span>A large sale needs a
            buyer.
          </Reveal>
          <Reveal as="p" className="body">
            ONyc is reinsurance-backed credit. Selling a large amount can return
            too little to repay a loan.
          </Reveal>
          <Counterfactual
            demo={DEMO_TERMS.onyc}
            receipt={onycReceipt}
            onWatch={watch}
          />
          <p className="source-line">
            OnRe allocates {ONRE_ENGINE.share} of its capital to ONyc liquidity.{" "}
            <a href={ONRE_ENGINE.url} target="_blank" rel="noreferrer">
              Issuer-funded exits already exist ↗
            </a>
          </p>
        </section>

        <section className="band" id="liquidation">
          <Reveal as="h2">
            <span className="kicker">02 · The proof</span>See who actually got
            paid.
          </Reveal>
          <p className="body">
            Captured {symbol} loan. Kamino&apos;s actual program. Local test
            funds.
          </p>
          <Liquidation
            demo={demo}
            receipt={receipt}
            running={running}
            output={data?.output ?? []}
            view={view}
            onViewChange={setView}
          />
          <p className="honest">
            {settlement
              ? `This replay repays ${usd(settlement.repaidUsdcAtoms, 2)} USDC of debt. Large-scale coverage remains illustrative.`
              : "Measured amounts appear after settlement. Large-scale coverage remains illustrative."}
          </p>
          {data?.enabled && (
            <details className="evidence-detail local-run">
              <summary>Run a fresh local replay</summary>
              <div className="evidence-content">
                <div className="controls">
                  <div
                    className="pair-switch"
                    role="radiogroup"
                    aria-label="Pair"
                  >
                    {Object.values(DEMO_TERMS).map(({ pair }) => (
                      <button
                        key={pair.id}
                        role="radio"
                        aria-checked={selectedPair === pair.id}
                        disabled={running}
                        onClick={() => setNextPair(pair.id)}
                      >
                        {pair.symbol} / USDC
                      </button>
                    ))}
                  </div>
                  <button
                    className="btn-primary"
                    disabled={loading || running}
                    onClick={() => void run()}
                  >
                    {running
                      ? "Running…"
                      : `Run ${DEMO_TERMS[selectedPair].pair.symbol} scenario`}
                    <span aria-hidden>→</span>
                  </button>
                </div>
                <p className="honest">
                  Runs captured mainnet state in a fresh local runtime. Open
                  “Demo info” for setup.
                </p>
              </div>
            </details>
          )}
          {error && (
            <p className="error-bar" role="alert">
              {error}
            </p>
          )}
        </section>

        <section className="band participants" id="value">
          <LiquidityField
            fracture={0}
            floor={0.75}
            className="participants-field"
          />
          <div className="participants-content">
            <h2>Capital from outside the issuer.</h2>
            <dl className="participant-roles">
              <div>
                <dt>The provider</dt>
                <dd>
                  Seeks a purchase discount. Takes credit, price and redemption
                  risk.
                </dd>
              </div>
              <div>
                <dt>The issuer</dt>
                <dd>
                  Could rent exit capacity instead of funding it from its own
                  balance sheet.
                </dd>
              </div>
              <div>
                <dt>The lender</dt>
                <dd>
                  Can inspect locked funds, a fixed price and an expiry.
                  Capacity is finite.
                </dd>
              </div>
            </dl>
            <p className="honest">
              Prototype · no outside provider has committed capital · no public
              contract deployment
            </p>
          </div>
        </section>

        <section className="band" id="proof">
          <Reveal as="h2">
            <span className="kicker">03 · Dig deeper</span>Inspect the evidence.
          </Reveal>
          <div className="evidence-list">
            <details className="evidence-detail">
              <summary>
                Safety checks{" "}
                <span>
                  {receipt?.status === "passed"
                    ? "Passed in replay"
                    : running
                      ? "Running…"
                      : "View checks"}
                </span>
              </summary>
              <div className="evidence-content">
                <Trust demo={demo} receipt={receipt} running={running} />
              </div>
            </details>
            <details className="evidence-detail">
              <summary>
                Transactions and receipt <span>Full local record</span>
              </summary>
              <div className="evidence-content proof-grid">
                <Ledger receipt={receipt} running={running} />
                <Receipt receipt={receipt} />
              </div>
            </details>
            <details className="evidence-detail">
              <summary>
                Market depth and sources <span>{OBSERVED_AT}</span>
              </summary>
              <div className="evidence-content">
                <DepthChart />
                <p className="honest">
                  Our snapshot measured {RWA_DEBT} of stablecoin debt against
                  RWA and yield tokens on Kamino. Quotes are observations, not
                  executed trades or proof that every exit fails.
                </p>
              </div>
            </details>
          </div>
        </section>
      </main>

      <footer className="story-footer">
        <span>Bidwall · committed exit liquidity for tokenized credit</span>
        <a
          href="https://github.com/jaypopat/bidwall"
          target="_blank"
          rel="noreferrer"
        >
          Source and local reproduction ↗
        </a>
      </footer>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Capacity } from "./components/story/capacity";
import { DepthChart } from "./components/story/depth-chart";
import { Liquidation } from "./components/story/liquidation";
import { LiquidityField } from "./components/story/liquidity-field";
import { CountUp, Reveal } from "./components/story/motion";
import { Ledger, QuoteCompare, Receipt } from "./components/story/proof";
import { DEMO_TERMS, demoBudget } from "./lib/bidwall/demo-terms";
import type { DemoPair, DemoReceipt, DemoResponse } from "./lib/demo/types";
import { timestamp, tokens, unixTime, usd } from "./lib/story/format";
import { ONRE_ENGINE, RWA_DEBT, STOCK_DEBT } from "./lib/story/data";
import { RECORDED_RECEIPT } from "./lib/story/recorded";

const NAV = [
  ["problem", "Problem"],
  ["bid", "The bid"],
  ["liquidation", "Liquidation"],
  ["capacity", "Capacity"],
  ["proof", "Proof"],
] as const;

export default function Home() {
  const [data, setData] = useState<DemoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestError, setRequestError] = useState<string>();
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

  const live = data?.receipt ?? null;
  // Without a local runtime (or before the first run) show the recorded run.
  const recorded = !live && !data?.running && !loading;
  const receipt: DemoReceipt | null =
    live ?? (recorded ? RECORDED_RECEIPT : null);
  // Shown values follow the receipt's own pair; the selector picks the next run.
  const selectedPair = nextPair ?? receipt?.pair.id ?? "onyc";
  const demo = DEMO_TERMS[receipt?.pair.id ?? selectedPair];
  const { symbol, decimals } = demo.pair;
  const budget = demoBudget(demo);
  const settlement = receipt?.settlement;
  const running = Boolean(data?.running);

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
      document
        .getElementById("liquidation")
        ?.scrollIntoView({ behavior: "smooth" });
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
  const clock = (seconds: string) => unixTime(seconds).split(", ")[1];

  return (
    <div className="story">
      <header className="story-nav">
        <a href="#top" className="brand" aria-label="Bidwall home">
          <span className="brand-mark" aria-hidden />
          Bidwall
        </a>
        <nav>
          {NAV.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>
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
        <section className="hero" id="problem">
          <LiquidityField fracture={1} className="hero-field" />
          <div className="hero-inner">
            <span className="kicker">01 · The problem</span>
            <h1>
              Selling $5M of ONyc costs{" "}
              <em>
                <CountUp
                  to={43}
                  duration={1800}
                  format={(v) => String(Math.round(v)).padStart(2, "\u2007")}
                />
                %
              </em>
              .
            </h1>
            <p className="lead">
              {RWA_DEBT} is borrowed on Kamino against tokenized credit: ONyc,
              USDe, AUTO and more. When those loans go bad, the collateral has
              to be sold. Much of it has nowhere to go.
            </p>
            <a className="scroll-cue" href="#depth">
              See the depth <span aria-hidden>↓</span>
            </a>
          </div>
        </section>

        <section className="band" id="depth">
          <Reveal>
            <DepthChart />
          </Reveal>
          <div className="facts">
            <Reveal className="fact" delay={100}>
              <strong>{RWA_DEBT}</strong>
              <p>
                stablecoin debt against RWA and yield tokens on Kamino.
                Tokenized stocks: {STOCK_DEBT}.
              </p>
            </Reveal>
            <Reveal className="fact" delay={200}>
              <strong>{ONRE_ENGINE.share}</strong>
              <p>
                of OnRe&apos;s own underwriting capital now funds buy quotes for
                ONyc ({ONRE_ENGINE.date}). &ldquo;{ONRE_ENGINE.quote}&rdquo;
              </p>
            </Reveal>
          </div>
        </section>

        <section className="answer">
          <Reveal as="p" className="answer-text">
            <strong>Bidwall is a buyer that is already waiting.</strong> A fund
            locks money in advance at a fixed price. When the lender liquidates,
            the bid buys the collateral inside the same transaction. No DEX
            depth needed, and the issuer doesn&apos;t pay for it.
          </Reveal>
        </section>

        <section className="band" id="bid">
          <div className="split">
            <div>
              <Reveal as="h2">
                <span className="kicker">02 · The bid</span>A fixed price, paid
                for upfront.
              </Reveal>
              <Reveal as="p" className="body" delay={80}>
                A provider escrows USDC for one collateral token, at one price,
                until one expiry. It can&apos;t be cancelled early, so lenders
                and risk teams can count it as real capacity.
              </Reveal>
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
                  disabled={loading || !data?.enabled || running}
                  onClick={() => void run()}
                >
                  {running
                    ? "Running…"
                    : `Run ${DEMO_TERMS[selectedPair].pair.symbol} scenario`}
                  <span aria-hidden>→</span>
                </button>
              </div>
              <p className="honest">
                {data?.enabled === false
                  ? `Showing a recorded run from ${timestamp(RECORDED_RECEIPT.startedAt)}. Clone the repo and run npm run dev:demo to replay it yourself.`
                  : "Runs a fresh local replay of captured mainnet state against the real Kamino program, with test funds. Not deployed to mainnet."}
              </p>
              {error && (
                <p className="error-bar" role="alert">
                  {error}
                </p>
              )}
            </div>
            <Reveal className="terms-card" delay={120}>
              <div className="terms-head">
                <span>{demo.market}</span>
                <span className="dot-live">Funded</span>
              </div>
              <div className="terms-price">
                {usd(demo.price, 2)}
                <span>USDC per {symbol}</span>
              </div>
              <dl>
                <div>
                  <dt>Up to</dt>
                  <dd>
                    {tokens(demo.quantity, decimals)} {symbol}
                  </dd>
                </div>
                <div>
                  <dt>Funded upfront</dt>
                  <dd>{usd(budget, 0)} USDC</dd>
                </div>
                <div>
                  <dt>Term</dt>
                  <dd>
                    {receipt?.commitment
                      ? `${clock(receipt.commitment.start).replace(" UTC", "")}–${clock(receipt.commitment.expiry)}`
                      : "One hour"}
                  </dd>
                </div>
              </dl>
              <div className="terms-dither" aria-hidden />
            </Reveal>
          </div>
        </section>

        <section className="band" id="liquidation">
          <Reveal as="h2">
            <span className="kicker">03 · The liquidation</span>Follow one loan,
            step by step.
          </Reveal>
          <Liquidation
            demo={demo}
            receipt={receipt}
            running={running}
            output={data?.output ?? []}
          />
        </section>

        <section className="hold">
          <LiquidityField fracture={0} floor={0.75} className="hold-field" />
          <Reveal as="p" className="hold-text">
            With a committed bid, the exit doesn&apos;t break.
            <small>
              {settlement
                ? `${tokens(settlement.deliveredCollateralAtoms, decimals, 2)} ${symbol} bought at ${usd(demo.price, 2)}. No slippage, no DEX.`
                : "Collateral bought at the bid price. No slippage, no DEX."}
            </small>
          </Reveal>
        </section>

        <section className="band" id="capacity">
          <Reveal as="h2">
            <span className="kicker">04 · Capacity</span>When the money is
            spent, it says no.
          </Reveal>
          <Reveal as="p" className="body" delay={80}>
            A separate replay funds a bid with exactly one liquidation&apos;s
            worth, spends it, then tries again. Capacity is real money, not a
            promise.
          </Reveal>
          <Capacity
            depletion={receipt?.depletion}
            symbol={symbol}
            decimals={decimals}
          />
        </section>

        <section className="band" id="proof">
          <Reveal as="h2">
            <span className="kicker">05 · Proof</span>Every step is on the
            record.
          </Reveal>
          <div className="proof-grid">
            <Ledger receipt={receipt} running={running} />
            <div className="proof-side">
              <Receipt receipt={receipt} />
              <QuoteCompare
                receipt={receipt}
                symbol={symbol}
                stressedLabel={demo.stressedLabel}
                quoting={quoting}
                quoteError={quoteError}
                disabled={running || receipt?.status !== "passed"}
                nowMs={nowMs}
                onQuote={() => void compareQuote()}
              />
            </div>
          </div>
        </section>
      </main>

      <footer className="story-footer">
        <span>Bidwall · committed exit liquidity for tokenized credit</span>
        <span>Local replay of captured mainnet state · test funds</span>
      </footer>
    </div>
  );
}

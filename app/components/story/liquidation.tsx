"use client";

import { useEffect, useRef, useState } from "react";
import type { DemoTerms } from "@/app/lib/bidwall/demo-terms";
import { demoBudget } from "@/app/lib/bidwall/demo-terms";
import type { DemoReceipt, DemoStage } from "@/app/lib/demo/types";
import { approx, tokens, usd } from "@/app/lib/story/format";
import { CountUp, useReducedMotion } from "./motion";

type Mode = DemoStage["mode"] | undefined;
type Beat = {
  id: "loan" | DemoStage["id"];
  kicker: string;
  title: string;
  body: string;
};

function beats(
  demo: DemoTerms,
  settlement?: DemoReceipt["settlement"]
): Beat[] {
  const { symbol } = demo.pair;
  const ltv = demo.loanLtv;
  return [
    {
      id: "loan",
      kicker: "The loan",
      title: `A real loan, backed by ${symbol}.`,
      body: `Captured from mainnet: ${symbol} deposited on Kamino, USDC borrowed against it.${ltv ? ` Kamino liquidates it if the loan-to-value passes ${ltv.liquidation}%.` : ""}`,
    },
    {
      id: "funded",
      kicker: "The commitment",
      title: "A fund commits before anything goes wrong.",
      body: `The provider escrows ${usd(demoBudget(demo), 0)} USDC to buy up to ${tokens(demo.quantity, demo.pair.decimals)} ${symbol} at ${usd(demo.price, 2)} each.`,
    },
    {
      id: "locked",
      kicker: "The lock",
      title: "The money can't leave early.",
      body: "We try to withdraw before expiry. The program refuses, so lenders can count the bid as real capacity.",
    },
    {
      id: "healthy",
      kicker: "The rules",
      title: "Kamino decides when to liquidate. Not us.",
      body: ltv
        ? `We try to liquidate the loan at ${ltv.healthy}% LTV. Kamino's own program refuses: the loan is healthy.`
        : "We try to liquidate the healthy loan. Kamino's own program refuses.",
    },
    {
      id: "stressed",
      kicker: "The shock",
      title: "The price drops.",
      body: `We lower the ${symbol} oracle price locally, from ${demo.healthyLabel} to ${demo.stressedLabel}. It's the only change we make to mainnet state.`,
    },
    {
      id: "settled",
      kicker: "The settlement",
      title: "One transaction. No DEX.",
      body: settlement
        ? `Kamino liquidates, and the bid buys the collateral in the same transaction: the lender is repaid ${usd(settlement.repaidUsdcAtoms, 2)} USDC and the borrower gets ${usd(settlement.borrowerUsdcAtoms, 2)} USDC back.`
        : "Kamino liquidates, and the bid buys the collateral in the same transaction: lender repaid, borrower paid the surplus, provider receives the collateral.",
    },
    {
      id: "withdrawn",
      kicker: "The expiry",
      title: "What's unspent goes home.",
      body: settlement
        ? `After expiry, the remaining ${usd(settlement.remainingFunds, 2)} USDC returns to the provider.`
        : "After expiry, the unspent escrow returns to the provider.",
    },
  ];
}

const MODE_LABEL: Record<NonNullable<Mode>, string> = {
  confirmed: "Confirmed",
  "rejected-in-simulation": "Blocked as expected",
  "local-override": "Local override",
};

export function Liquidation({
  demo,
  receipt,
  running,
  output,
}: {
  demo: DemoTerms;
  receipt: DemoReceipt | null;
  running: boolean;
  /** Runner output lines; the tail is shown while a run is live. */
  output: string[];
}) {
  const settlement = receipt?.settlement;
  const list = beats(demo, settlement);
  const modes = new Map(receipt?.stages.map((s) => [s.id, s.mode]));
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting)
            setActive(Number((entry.target as HTMLElement).dataset.index));
      },
      { rootMargin: "-48% 0px -48% 0px" }
    );
    refs.current.forEach((element) => element && observer.observe(element));
    return () => observer.disconnect();
  }, []);

  // During a live run, follow the newest completed stage.
  const done = receipt?.stages.length ?? 0;
  useEffect(() => {
    if (!running) return;
    const latest = receipt?.stages.at(-1)?.id;
    const target = latest ? list.findIndex((b) => b.id === latest) : 0;
    refs.current[Math.max(0, target)]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, done]);

  const beat = list[active];
  const mode = beat.id === "loan" ? undefined : modes.get(beat.id);
  return (
    <div className="scrolly">
      <ol className="scrolly-beats">
        {list.map((item, index) => {
          const itemMode = item.id === "loan" ? undefined : modes.get(item.id);
          return (
            <li
              key={item.id}
              ref={(element) => {
                refs.current[index] = element;
              }}
              data-index={index}
              className={`beat ${index === active ? "is-active" : ""}`}
            >
              <span className="beat-kicker">
                {String(index + 1).padStart(2, "0")} · {item.kicker}
              </span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              {item.id !== "loan" && (
                <StageChip mode={itemMode} running={running} />
              )}
            </li>
          );
        })}
      </ol>
      <div className="scrolly-stage" aria-live="polite">
        <div className="stage-frame">
          <div className="stage-head">
            <span>
              {demo.pair.symbol} / USDC · {demo.market}
            </span>
            {beat.id !== "loan" && <StageChip mode={mode} running={running} />}
          </div>
          <div className="stage-body" key={beat.id}>
            <Visual beat={beat.id} demo={demo} receipt={receipt} />
          </div>
          {running && (
            <ol className="stage-log" aria-label="Runner output">
              {output.slice(-3).map((line, i) => (
                <li key={`${i}-${line}`}>{line}</li>
              ))}
            </ol>
          )}
          <Progress count={list.length} active={active} />
        </div>
      </div>
    </div>
  );
}

function StageChip({ mode, running }: { mode: Mode; running: boolean }) {
  return (
    <span className={`stage-chip ${mode ?? (running ? "running" : "waiting")}`}>
      {mode ? MODE_LABEL[mode] : running ? "Running…" : "Run to verify"}
    </span>
  );
}

function Progress({ count, active }: { count: number; active: number }) {
  return (
    <div className="stage-progress" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={i <= active ? "on" : ""} />
      ))}
    </div>
  );
}

function Visual({
  beat,
  demo,
  receipt,
}: {
  beat: Beat["id"];
  demo: DemoTerms;
  receipt: DemoReceipt | null;
}) {
  const settlement = receipt?.settlement;
  const budget = demoBudget(demo);
  switch (beat) {
    case "loan":
      return <Gauge demo={demo} position="healthy" label="Loan health" />;
    case "funded":
      return <Vault demo={demo} />;
    case "locked":
      return <Vault demo={demo} stamp="Withdrawal refused" />;
    case "healthy":
      return (
        <Gauge
          demo={demo}
          position="healthy"
          label="Loan health"
          stamp="Kamino: not liquidatable"
        />
      );
    case "stressed":
      return <Shock demo={demo} />;
    case "settled":
      return <MoneyFlow demo={demo} settlement={settlement} />;
    case "withdrawn":
      return (
        <Escrow
          budget={budget}
          used={settlement?.paidUsdcAtoms}
          remaining={settlement?.remainingFunds}
        />
      );
  }
}

function Gauge({
  demo,
  position,
  label,
  stamp,
}: {
  demo: DemoTerms;
  position: "healthy" | "stressed";
  label: string;
  stamp?: string;
}) {
  const ltv = demo.loanLtv;
  // Without a captured LTV, place the marker qualitatively either side of the line.
  const line = ltv?.liquidation ?? 75;
  const value = position === "healthy" ? (ltv?.healthy ?? line - 12) : line + 9;
  return (
    <div className="vis vis-gauge">
      <span className="vis-label">{label}</span>
      <div className="gauge">
        <div className="gauge-track">
          <span className="gauge-fill" style={{ width: `${value}%` }} />
          <span className="gauge-line" style={{ left: `${line}%` }}>
            <em>liquidation at {ltv ? `${line}%` : "threshold"}</em>
          </span>
          <span
            className={`gauge-marker ${position}`}
            style={{ left: `${value}%` }}
          >
            <b>
              {position === "healthy" && ltv
                ? `${ltv.healthy}% LTV`
                : position === "healthy"
                  ? "healthy"
                  : "past the line"}
            </b>
          </span>
        </div>
        <div className="gauge-scale">
          <span>0%</span>
          <span>100% LTV</span>
        </div>
      </div>
      <dl className="vis-facts">
        <div>
          <dt>Collateral</dt>
          <dd>{demo.pair.symbol}</dd>
        </div>
        <div>
          <dt>Debt</dt>
          <dd>USDC</dd>
        </div>
        <div>
          <dt>Lender</dt>
          <dd>Kamino v2</dd>
        </div>
      </dl>
      {stamp && <span className="stamp">{stamp}</span>}
    </div>
  );
}

function Vault({ demo, stamp }: { demo: DemoTerms; stamp?: string }) {
  const budget = demoBudget(demo);
  return (
    <div className="vis vis-vault">
      <span className="vis-label">Bid escrow</span>
      <div className="vault">
        <div className="vault-fill dither-fill" />
        <div className="vault-amount">
          <CountUp
            to={approx(budget.toString(), 6)}
            duration={1100}
            format={(v) => Math.round(v).toLocaleString("en-US")}
          />
          <span>USDC</span>
        </div>
        <svg className="vault-lock" viewBox="0 0 24 24" aria-hidden>
          <path d="M7 11V8a5 5 0 0 1 10 0v3" />
          <rect x="5" y="11" width="14" height="10" rx="1.5" />
        </svg>
      </div>
      <dl className="vis-facts">
        <div>
          <dt>Price</dt>
          <dd>
            {usd(demo.price, 2)} / {demo.pair.symbol}
          </dd>
        </div>
        <div>
          <dt>Up to</dt>
          <dd>
            {tokens(demo.quantity, demo.pair.decimals)} {demo.pair.symbol}
          </dd>
        </div>
        <div>
          <dt>Term</dt>
          <dd>Locked until expiry</dd>
        </div>
      </dl>
      {stamp && <span className="stamp">{stamp}</span>}
    </div>
  );
}

function Shock({ demo }: { demo: DemoTerms }) {
  const from = Number(demo.healthyLabel);
  const to = Number(demo.stressedLabel);
  const places = demo.healthyLabel.split(".")[1]?.length ?? 0;
  return (
    <div className="vis vis-shock">
      <span className="vis-label">{demo.pair.symbol} oracle price · local</span>
      <div className="shock-price">
        <CountUp
          from={from}
          to={to}
          duration={1600}
          format={(v) => v.toFixed(places)}
        />
        <span className="shock-arrow">↓</span>
        <small>from {demo.healthyLabel}</small>
      </div>
      <Gauge demo={demo} position="stressed" label="Loan health" />
    </div>
  );
}

function MoneyFlow({
  demo,
  settlement,
}: {
  demo: DemoTerms;
  settlement?: DemoReceipt["settlement"];
}) {
  const reduced = useReducedMotion();
  const { symbol, decimals } = demo.pair;
  const flows = [
    {
      id: "in",
      d: "M110 70 C 180 70 190 180 250 180",
      tone: "usdc",
      dots: 4,
    },
    {
      id: "lender",
      d: "M370 160 C 430 160 430 70 480 70",
      tone: "usdc",
      dots: 4,
    },
    {
      id: "borrower",
      d: "M370 180 C 420 180 430 180 480 180",
      tone: "usdc",
      dots: 1,
    },
    {
      id: "provider",
      d: "M370 200 C 430 200 430 290 480 290",
      tone: "collateral",
      dots: 4,
    },
    {
      id: "seized",
      d: "M110 290 C 180 290 190 200 250 200",
      tone: "collateral",
      dots: 4,
    },
  ];
  return (
    <div className="vis vis-flow">
      <svg viewBox="0 0 620 360" role="img" aria-label="Settlement money flow">
        <defs>
          {flows.map((f) => (
            <path key={f.id} id={`flow-${f.id}`} d={f.d} />
          ))}
        </defs>
        {flows.map((f) => (
          <use
            key={f.id}
            href={`#flow-${f.id}`}
            className={`flow-path ${f.tone}`}
          />
        ))}
        {!reduced &&
          flows.flatMap((f) =>
            Array.from({ length: f.dots }, (_, i) => (
              <circle
                key={`${f.id}-${i}`}
                r={4}
                className={`flow-dot ${f.tone}`}
              >
                <animateMotion
                  dur="2.4s"
                  repeatCount="indefinite"
                  begin={`-${(i * 2.4) / f.dots}s`}
                >
                  <mpath href={`#flow-${f.id}`} />
                </animateMotion>
              </circle>
            ))
          )}
        <g className="flow-tx">
          <rect x={240} y={130} width={140} height={100} rx={10} />
          <text x={310} y={172} textAnchor="middle">
            Kamino
          </text>
          <text x={310} y={192} textAnchor="middle" className="small">
            liquidation · 1 tx
          </text>
        </g>
        <FlowNode
          x={10}
          y={50}
          title="Bid escrow"
          value={`${usd(settlement?.paidUsdcAtoms, 2)} USDC`}
        />
        <FlowNode
          x={10}
          y={270}
          title="Seized collateral"
          value={`${tokens(settlement?.deliveredCollateralAtoms, decimals, 2)} ${symbol}`}
        />
        <FlowNode
          x={486}
          y={50}
          title="Lender"
          value={`${usd(settlement?.repaidUsdcAtoms, 2)} USDC`}
          align="end"
        />
        <FlowNode
          x={486}
          y={160}
          title="Borrower"
          value={`${usd(settlement?.borrowerUsdcAtoms, 2)} USDC`}
          align="end"
        />
        <FlowNode
          x={486}
          y={270}
          title="Provider"
          value={`${tokens(settlement?.deliveredCollateralAtoms, decimals, 2)} ${symbol}`}
          align="end"
          accent
        />
      </svg>
      {!settlement && (
        <p className="vis-note">
          Run the scenario to fill in measured amounts.
        </p>
      )}
    </div>
  );
}

function FlowNode({
  x,
  y,
  title,
  value,
  align = "start",
  accent = false,
}: {
  x: number;
  y: number;
  title: string;
  value: string;
  align?: "start" | "end";
  accent?: boolean;
}) {
  return (
    <g className={`flow-node ${accent ? "accent" : ""}`}>
      <text
        x={align === "end" ? x + 124 : x}
        y={y}
        textAnchor={align}
        className="small"
      >
        {title}
      </text>
      <text x={align === "end" ? x + 124 : x} y={y + 22} textAnchor={align}>
        {value}
      </text>
    </g>
  );
}

function Escrow({
  budget,
  used,
  remaining,
}: {
  budget: bigint;
  used?: string;
  remaining?: string;
}) {
  const percent = used ? Number((BigInt(used) * 100n) / budget) : 0;
  return (
    <div className="vis vis-escrow">
      <span className="vis-label">Escrow after the liquidation</span>
      <div className="escrow-bar">
        <span
          className="escrow-used dither-fill"
          style={{ width: `${percent}%` }}
        />
        <span className="escrow-left" />
      </div>
      <div className="escrow-key">
        <span>
          <i className="used" /> Spent {usd(used, 2)} USDC · {percent}%
        </span>
        <span>
          <i className="left" /> Returned {usd(remaining, 2)} USDC
        </span>
      </div>
      <p className="vis-note">
        Funded {usd(budget, 2)} USDC upfront. Only what the liquidation used was
        spent.
      </p>
    </div>
  );
}

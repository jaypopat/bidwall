"use client";

import type { DemoTerms } from "@/app/lib/bidwall/demo-terms";
import type { DemoReceipt } from "@/app/lib/demo/types";
import { Capacity } from "./capacity";
import { Reveal } from "./motion";

type Check = {
  title: string;
  body: string;
  passed: boolean | undefined;
};

/** The safety properties behind "lenders can count on it", each tied to the run. */
export function Trust({
  demo,
  receipt,
  running,
}: {
  demo: DemoTerms;
  receipt: DemoReceipt | null;
  running: boolean;
}) {
  const stage = (id: string) =>
    receipt?.stages.find((s) => s.id === id)?.mode === "rejected-in-simulation"
      ? true
      : undefined;
  const replay = receipt?.steps.find((s) => /replay/i.test(s.label));
  const ltv = demo.loanLtv;
  const checks: Check[] = [
    {
      title: "The money is locked",
      body: "Withdrawing before expiry is refused by the program. The funded capacity stays committed until it is spent or the term ends.",
      passed: stage("locked"),
    },
    {
      title: "Kamino decides, not us",
      body: ltv
        ? `Liquidating the loan while it was healthy (${ltv.healthy}% LTV) was refused by Kamino's own program.`
        : "Liquidating the loan while it was healthy was refused by Kamino's own program.",
      passed: stage("healthy"),
    },
    {
      title: "A stale fill is refused",
      body: "Repeating the first settlement with its old bid expectation is refused after that bid has been filled.",
      passed: replay ? replay.status === "rejected-in-simulation" : undefined,
    },
  ];
  return (
    <>
      <div className="checks">
        {checks.map((check, i) => (
          <Reveal key={check.title} className="check" delay={i * 90}>
            <span
              className={`stage-chip ${check.passed ? "rejected-in-simulation" : running ? "running" : "waiting"}`}
            >
              {check.passed
                ? "Blocked as expected"
                : running
                  ? "Running…"
                  : receipt?.status === "failed"
                    ? "Not verified"
                    : "Run to verify"}
            </span>
            <h3>{check.title}</h3>
            <p>{check.body}</p>
          </Reveal>
        ))}
      </div>
      <h3 className="sub-head">And when the money runs out, it says no.</h3>
      <Capacity
        depletion={receipt?.depletion}
        symbol={demo.pair.symbol}
        decimals={demo.pair.decimals}
      />
    </>
  );
}

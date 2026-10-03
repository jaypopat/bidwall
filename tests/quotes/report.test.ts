import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JUPITER_ENDPOINTS } from "../../scripts/quotes/jupiter.ts";
import { readObservations, renderReport } from "../../scripts/quotes/report.ts";
import type { Session } from "../../scripts/quotes/session.ts";
import type {
  Observation,
  QuoteObservation,
} from "../../scripts/quotes/types.ts";

function observation(
  observedAt: string,
  session: Session,
  quote: Partial<QuoteObservation>
): Observation {
  return {
    schema: "bidwall.quote-observation/v1",
    label: "Mainnet Jupiter quote, not executed",
    observedAt,
    newYorkTime: "",
    session,
    runner: "local",
    slippageBps: 50,
    endpoints: JUPITER_ENDPOINTS,
    tokens: [
      {
        symbol: "NVDAx",
        mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
        decimals: 8,
        status: "ok",
        quotes: [
          {
            lot: "demo-lot",
            inAmountRaw: "1",
            notionalUsd: "1.00",
            status: "ok",
            ...quote,
          },
        ],
      },
    ],
    raw: { path: "", sha256: "" },
  };
}

const weekendA = observation("2026-10-03T19:07:00.000Z", "weekend", {
  deviationBps: -100,
});
const weekendB = observation("2026-10-03T20:07:00.000Z", "weekend", {
  deviationBps: -300,
});
const weekendNoRoute = observation("2026-10-03T21:07:00.000Z", "weekend", {
  status: "no-route",
});
const monday = observation("2026-10-05T14:07:00.000Z", "regular", {
  deviationBps: 50,
});

describe("renderReport", () => {
  test("shows the median deviation per session and the no-route count", () => {
    expect(renderReport([weekendA, weekendB, weekendNoRoute, monday])).toBe(
      [
        "4 observations, 2026-10-03T19:07:00.000Z to 2026-10-05T14:07:00.000Z.",
        "Median deviation from Jupiter's reference price (count). Quotes, not executions.",
        "",
        "| Token | Lot | weekend | regular | No route |",
        "| --- | --- | ---: | ---: | ---: |",
        "| NVDAx | demo-lot | −2.00% (2) | +0.50% (1) | 1 of 4 |",
      ].join("\n")
    );
  });

  test("says so when there is nothing to report", () => {
    expect(renderReport([])).toBe("No observations found.");
  });
});

describe("readObservations", () => {
  test("reads every day file in chronological order", () => {
    const dir = mkdtempSync(join(tmpdir(), "quotes-"));
    const line = (o: Observation) => `${JSON.stringify(o)}\n`;
    writeFileSync(join(dir, "2026-10-05.jsonl"), line(monday));
    writeFileSync(
      join(dir, "2026-10-03.jsonl"),
      line(weekendA) + line(weekendB)
    );
    writeFileSync(join(dir, "README.md"), "not data");

    expect(readObservations(dir).map((o) => o.observedAt)).toEqual([
      "2026-10-03T19:07:00.000Z",
      "2026-10-03T20:07:00.000Z",
      "2026-10-05T14:07:00.000Z",
    ]);
  });
});

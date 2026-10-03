import { expect, test } from "bun:test";
import { absorbableDepth, runScenarios } from "../../scripts/risk/scenarios.ts";
import { SF } from "../../scripts/risk/kamino.ts";
import type { ObservationDraft } from "../../scripts/quotes/types.ts";
import {
  debtReserve,
  loan,
  market,
  quoteToken,
  reserve,
  stock,
} from "./fixtures.ts";

test("interpolates a crossing between adjacent complete ladder quotes", () => {
  expect(absorbableDepth(quoteToken([-100, -900]), 500)).toEqual({
    atoms: 30_000_000_000n,
    isLowerBound: false,
  });
});
test("marks the upper ladder limit and the unmeasured sub-$10k range as bounds", () => {
  expect(absorbableDepth(quoteToken([-100]), 500)).toEqual({
    atoms: 1_000_000_000_000n,
    isLowerBound: true,
  });
  expect(absorbableDepth(quoteToken([-501]), 500)).toEqual({
    atoms: 0n,
    isLowerBound: true,
  });
});
test("distinguishes an unknown request error from an observed lack of route", () => {
  expect(absorbableDepth(undefined, 500).atoms).toBeNull();
  const token = quoteToken([-100]);
  token.quotes[0]!.status = "error";
  expect(absorbableDepth(token, 500).atoms).toBeNull();
  token.quotes[0]!.status = "no-route";
  expect(absorbableDepth(token, 500)).toEqual({
    atoms: 0n,
    isLowerBound: true,
  });
});
test("never interpolates across a missing/failed lot or re-enters after a crossing", () => {
  const token = quoteToken([-100, -300, -800, -100]);
  token.quotes[1]!.status = "error";
  expect(absorbableDepth(token, 500)).toEqual({
    atoms: 10_000_000_000n,
    isLowerBound: true,
  });
  token.quotes[1]!.status = "ok";
  expect(absorbableDepth(token, 500)).toEqual({
    atoms: 70_000_000_000n,
    isLowerBound: false,
  });
});
test("values exit depth and release at the same shocked oracle price, not the quote's dollar lot", () => {
  const r = reserve({ decimals: stock.decimals, priceSf: SF });
  const map = new Map([r, debtReserve()].map((r) => [r.address, r]));
  const q = {
    tokens: [quoteToken([-100])],
    observedAt: "2026-10-03T00:00:00Z",
  } as ObservationDraft;
  const results = runScenarios([loan()], map, market, q);
  const baseline = results[0]!.rows.find((r) => r.symbol === "NVDAx")!;
  const shock = results
    .find((r) => r.id === "NVDAx-30")!
    .rows.find((r) => r.symbol === "NVDAx")!;
  expect(baseline.absorbableUsd).toBe("10000.000000");
  expect(shock.absorbableUsd).toBe("6999.999999"); // Q60 price scaling rounds down by less than one micro-dollar.
  expect(shock.absorbableAtoms).toBe(baseline.absorbableAtoms);
  expect(shock.shortfallIsUpperBound).toBe(true);
});

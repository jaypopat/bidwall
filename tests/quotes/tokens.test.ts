import { expect, test } from "bun:test";
import { TRACKED_TOKENS } from "../../scripts/quotes/tokens.ts";

test("tracks every xStock that Kamino's public xStocks market holds as collateral", () => {
  expect(TRACKED_TOKENS.map((t) => t.symbol)).toEqual([
    "SPYx",
    "MSTRx",
    "GOOGLx",
    "QQQx",
    "TSLAx",
    "NVDAx",
    "CRCLx",
    "HOODx",
    "AAPLx",
  ]);
});

test("identifies each token by a distinct 8-decimal mint", () => {
  const mints = TRACKED_TOKENS.map((t) => t.mint);
  expect(new Set(mints).size).toBe(mints.length);
  expect(TRACKED_TOKENS.every((t) => t.decimals === 8)).toBe(true);
});

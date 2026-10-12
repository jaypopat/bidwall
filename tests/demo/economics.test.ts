import { describe, expect, test } from "bun:test";
import { DEMO_TERMS } from "../../app/lib/bidwall/demo-terms.ts";
import type { DemoReceipt } from "../../app/lib/demo/types.ts";
import { liquidationComparison } from "../../app/lib/story/economics.ts";
import recorded from "../../app/lib/story/recorded-receipt.json";

const receipt = recorded as DemoReceipt;
const demo = DEMO_TERMS.onyc;

describe("liquidation comparison", () => {
  test("applies the sale haircut to collateral, including the liquidation uplift", () => {
    const model = liquidationComparison(demo, receipt, 5_000_000, 43)!;
    // 1,078.793553683 ONyc × $0.95 × 57% = $584.1667093193
    // compared with $1,000 debt. Adding percentages would overstate proceeds.
    expect(model.dexMarginPct).toBeCloseTo(-41.5833290681, 8);
    expect(
      liquidationComparison(demo, receipt, 100_000, 0.31)!.dexMarginPct
    ).toBeGreaterThan(2);
  });

  test("requires scaled funding and reproduces the measured borrower surplus", () => {
    const model = liquidationComparison(demo, receipt, 5_000_000, 43)!;
    expect(model.requiredEscrowUsdc).toBeCloseTo(4_947_368.421052632, 5);
    expect(model.bidSurplusPct).toBeCloseTo(1.4065940462, 8);
    expect(Number(receipt.settlement!.paidUsdcAtoms) / 1e6).toBeCloseTo(
      1_014.06594,
      6
    );
  });

  test("a fully lost sale cannot repay debt even when the collateral has a bonus", () => {
    expect(
      liquidationComparison(demo, receipt, 5_000_000, 100)!.dexMarginPct
    ).toBe(-100);
  });

  test("does not extrapolate failed, missing or mismatched receipts", () => {
    expect(
      liquidationComparison(demo, { ...receipt, status: "failed" }, 100_000, 1)
    ).toBeNull();
    expect(
      liquidationComparison(
        demo,
        { ...receipt, settlement: undefined },
        100_000,
        1
      )
    ).toBeNull();
    expect(
      liquidationComparison(DEMO_TERMS.nvdax, receipt, 100_000, 1)
    ).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { SF, USD } from "../../scripts/risk/kamino.ts";
import { formatUsd, valueLoan } from "../../scripts/risk/valuation.ts";
import {
  firstLiquidation,
  runScenarios,
} from "../../scripts/risk/scenarios.ts";
import {
  debtReserve,
  loan,
  market,
  otherStock,
  reserve,
  stock,
} from "./fixtures.ts";

const reserves = () =>
  new Map([reserve(), debtReserve()].map((r) => [r.address, r]));
describe("valuation and first-liquidation estimates", () => {
  test("subtracts all reserve fees and preserves fractional borrow amounts", () => {
    const map = reserves();
    map.set(
      stock.mint,
      reserve({
        availableAtoms: 900n,
        borrowedSf: 300n * SF,
        feesSf: 200n * SF,
        collateralSupply: 500n,
      })
    );
    const valued = valueLoan(
      loan({
        borrows: [
          { reserve: debtReserve().address, borrowedSf: 600n * SF + SF / 2n },
        ],
      }),
      map
    );
    expect(valued.deposits[0]!.atoms).toBe(20n);
    expect(valued.depositUsd).toBe(2000n * USD);
    expect(valued.debtUsd).toBe(600_500_000n);
    expect(valued.thresholdUsd).toBe(1300n * USD);
    expect(valued.liquidatable).toBe(false);
    expect(formatUsd(valued.debtUsd)).toBe("600.500000");
  });
  test("uses borrow-factor adjusted debt and liquidates at equality", () => {
    const map = reserves();
    map.set(debtReserve().address, debtReserve({ borrowFactorPct: 125n }));
    expect(valueLoan(loan(), map).adjustedDebtUsd).toBe(750n * USD);
    expect(valueLoan(loan(), map).liquidatable).toBe(true);
    expect(
      valueLoan(
        loan({
          borrows: [{ reserve: debtReserve().address, borrowedSf: 520n * SF }],
        }),
        map
      ).liquidatable
    ).toBe(true);
    expect(
      valueLoan(
        loan({
          borrows: [{ reserve: debtReserve().address, borrowedSf: 519n * SF }],
        }),
        map
      ).liquidatable
    ).toBe(false);
  });
  test("shocks deposits and debts by verified mint", () => {
    const map = reserves();
    const xdebt = reserve({
      address: otherStock.mint,
      ...otherStock,
      decimals: 0,
      priceSf: 100n * SF,
    });
    map.set(xdebt.address, xdebt);
    const l = loan({
      borrows: [{ reserve: xdebt.address, borrowedSf: 6n * SF }],
    });
    const results = runScenarios([l], map, market, null);
    expect(results).toHaveLength(31);
    expect(results.find((s) => s.id === "NVDAx-10")!.liquidatableLoans).toBe(1);
    expect(results.find((s) => s.id === "GOOGLx-10")!.liquidatableLoans).toBe(
      0
    );
    expect(results.find((s) => s.id === "all-30")!.liquidatableLoans).toBe(0);
    expect(
      results[0]!.rows.find((r) => r.symbol === "NVDAx")!.shortfallUsd
    ).toBeNull();
  });
  test("splits release proportionally, counts a multi-collateral loan once in scenario totals", () => {
    const map = reserves();
    map.set(
      otherStock.mint,
      reserve({ address: otherStock.mint, ...otherStock, decimals: 0 })
    );
    const l = loan({
      deposits: [
        { reserve: stock.mint, ctokens: 60n },
        { reserve: otherStock.mint, ctokens: 40n },
      ],
      borrows: [{ reserve: debtReserve().address, borrowedSf: 7000n * SF }],
    });
    const valued = valueLoan(l, map);
    const first = firstLiquidation(valued, market);
    expect(first.repayUsd).toBe(1400n * USD);
    expect(first.released.map((r) => r.atoms)).toEqual([8n, 5n]); // 8.82 and 5.88, floored to token atoms
    const scenario = runScenarios([l], map, market, null)[0]!;
    expect(scenario.liquidatableLoans).toBe(1);
    expect(scenario.liquidatableDebtUsd).toBe("7000.000000");
    expect(scenario.rows.filter((r) => r.loans === 1)).toHaveLength(2);
    expect(
      scenario.rows.find((r) => r.symbol === "NVDAx")!.liquidatableDebtUsd
    ).toBe("7000.000000");
  });
  test("applies the $1M cap, the strict insolvency override, and the small-debt full repayment", () => {
    const map = reserves();
    const huge = loan({
      deposits: [{ reserve: stock.mint, ctokens: 100_000n }],
      borrows: [
        { reserve: debtReserve().address, borrowedSf: 7_000_000n * SF },
      ],
    });
    expect(firstLiquidation(valueLoan(huge, map), market).repayUsd).toBe(
      1_000_000n * USD
    );
    const at = loan({
      borrows: [{ reserve: debtReserve().address, borrowedSf: 950n * SF }],
    });
    expect(firstLiquidation(valueLoan(at, map), market).repayUsd).toBe(
      190n * USD
    );
    const above = loan({
      borrows: [{ reserve: debtReserve().address, borrowedSf: 951n * SF }],
    });
    expect(firstLiquidation(valueLoan(above, map), market).repayUsd).toBe(
      951n * USD
    );
    expect(
      firstLiquidation(
        valueLoan(
          loan({
            borrows: [{ reserve: debtReserve().address, borrowedSf: SF }],
          }),
          map
        ),
        market
      ).repayUsd
    ).toBe(USD);
    expect(
      firstLiquidation(
        valueLoan(
          loan({
            borrows: [{ reserve: debtReserve().address, borrowedSf: 2n * SF }],
          }),
          map
        ),
        market
      ).repayUsd
    ).toBe(400_000n);
  });
  test("caps the first repayment by the highest-borrow-factor debt leg", () => {
    const map = reserves();
    map.set(
      otherStock.mint,
      reserve({
        address: otherStock.mint,
        ...otherStock,
        decimals: 0,
        borrowFactorPct: 250n,
        priceSf: SF,
      })
    );
    const l = loan({
      borrows: [
        { reserve: debtReserve().address, borrowedSf: 600n * SF },
        { reserve: otherStock.mint, borrowedSf: 50n * SF },
      ],
    });
    expect(firstLiquidation(valueLoan(l, map), market).repayUsd).toBe(
      50n * USD
    );
  });
  test("caps released atoms at each deposit, excludes elevation groups and invalid valuations", () => {
    const first = firstLiquidation(
      valueLoan(
        loan({
          borrows: [{ reserve: debtReserve().address, borrowedSf: 2000n * SF }],
        }),
        reserves()
      ),
      market
    );
    expect(first.released[0]!.atoms).toBe(10n);
    expect(() => valueLoan(loan({ elevationGroup: 1 }), reserves())).toThrow(
      "elevation-group"
    );
    const map = reserves();
    map.set(stock.mint, reserve({ collateralSupply: 0n }));
    expect(() => valueLoan(loan(), map)).toThrow("exchange-rate");
  });
});

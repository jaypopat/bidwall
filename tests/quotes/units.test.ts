import { describe, expect, test } from "bun:test";
import {
  atomsForUsd,
  centsForAtoms,
  deviationBps,
  formatBps,
  formatCents,
  parsePrice,
} from "../../scripts/quotes/units.ts";

describe("parsePrice", () => {
  test("converts a JSON price to 12-decimal fixed point", () => {
    expect(parsePrice(234.73351303753438)).toBe(234_733_513_037_534n);
    expect(parsePrice(100)).toBe(100_000_000_000_000n);
  });

  test("rejects prices that cannot be trusted", () => {
    for (const bad of [
      0,
      -1,
      1e-13,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1e9,
    ]) {
      expect(() => parsePrice(bad)).toThrow("Unusable price");
    }
  });
});

describe("lot sizing", () => {
  test("rounds atoms down so the lot never exceeds the notional", () => {
    const nvdax = parsePrice(234.73351303753438);
    expect(atomsForUsd(10_000n, 8, nvdax)).toBe(4_260_150_104n);
    expect(atomsForUsd(1_000_000n, 8, nvdax)).toBe(426_015_010_408n);
  });

  test("values the demo lot in whole cents", () => {
    const price = parsePrice(234.4961011263661);
    expect(centsForAtoms(396_422_366n, 8, price)).toBe(92_959n);
    expect(formatCents(92_959n)).toBe("929.59");
    expect(formatCents(5n)).toBe("0.05");
  });
});

describe("deviationBps", () => {
  const usdc = (atoms: bigint) => ({ atoms, decimals: 6 });
  const token = (atoms: bigint) => ({ atoms, decimals: 8 });

  test("matches the live NVDAx demo-lot quote from 3 October", () => {
    const price = parsePrice(234.4961011263661);
    expect(deviationBps(token(396_422_366n), usdc(931_322_087n), price)).toBe(
      18
    );
  });

  test("is exact for round numbers and rounds toward negative infinity", () => {
    const price = parsePrice(100);
    expect(deviationBps(token(100_000_000n), usdc(99_000_000n), price)).toBe(
      -100
    );
    expect(deviationBps(token(100_000_000n), usdc(98_999_999n), price)).toBe(
      -101
    );
  });

  test("refuses a zero-sized sale", () => {
    expect(() => deviationBps(token(0n), usdc(1n), parsePrice(100))).toThrow(
      "zero"
    );
  });
});

describe("formatBps", () => {
  test("shows a signed percentage with a true minus sign", () => {
    expect(formatBps(18)).toBe("+0.18%");
    expect(formatBps(-3385)).toBe("−33.85%");
    expect(formatBps(0)).toBe("0.00%");
  });
});

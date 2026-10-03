import { describe, expect, test } from "bun:test";
import {
  addressBytes,
  addressFromBytes,
  decodeLoan,
  decodeMarket,
  decodeReserve,
  MARKET,
  PROGRAM,
  SF,
  USD,
  ZERO,
} from "../../scripts/risk/kamino.ts";
import { account, fixture } from "./fixtures.ts";

describe("captured mainnet layouts", () => {
  test("round-trips leading-zero and live addresses", () => {
    for (const address of [
      ZERO,
      PROGRAM,
      MARKET,
      ...fixture.reserves.map((r) => r.address),
    ])
      expect(addressFromBytes(addressBytes(address))).toBe(address);
    expect(() => addressBytes("1".repeat(33))).toThrow();
    expect(() => addressBytes("z".repeat(44))).toThrow();
  });
  test("decodes NVDAx, GOOGLx and USDC, with Q60 prices and observed config", () => {
    const reserves = fixture.reserves.map((r) => decodeReserve(account(r)));
    for (const symbol of ["NVDAx", "GOOGLx", "USDC"]) {
      const r = reserves.find((r) => r.symbol === symbol)!;
      expect(r.priceSf).toBeGreaterThan(0n);
      expect(r.collateralSupply).toBeGreaterThan(0n);
      expect(r.decimals).toBe(symbol === "USDC" ? 6 : 8);
      expect(r.minBonusBps).toBe(500);
    }
    const usdc = reserves.find((r) => r.symbol === "USDC")!;
    expect(Number((usdc.priceSf * 10_000n) / SF)).toBeGreaterThan(9900);
    expect(Number((usdc.priceSf * 10_000n) / SF)).toBeLessThan(10100);
    const m = decodeMarket(account(fixture.market));
    expect(m).toEqual({
      closeFactorPct: 20,
      insolvencyLtvPct: 95,
      minFullLiquidationUsd: 2n * USD,
      maxRepayUsd: 1_000_000n * USD,
      emergencyMode: false,
      priceLiquidationDisabled: false,
    });
    expect(fixture.loans.length).toBeGreaterThanOrEqual(6);
    const loans = fixture.loans.map((r) =>
      decodeLoan(account({ address: r.pubkey, account: r.account }))
    );
    expect(
      loans.every((l) => l.borrows.length > 0 && l.elevationGroup === 0)
    ).toBe(true);
    expect(loans.some((l) => l.deposits.length > 1)).toBe(true);
  });
  test("rejects wrong owner, size, discriminator and market", () => {
    for (const [decode, row] of [
      [decodeReserve, fixture.reserves[0]!],
      [decodeMarket, fixture.market],
      [
        decodeLoan,
        {
          address: fixture.loans[0]!.pubkey,
          account: fixture.loans[0]!.account,
        },
      ],
    ] as const) {
      const original = account(row);
      expect(() => decode({ ...original, owner: ZERO })).toThrow("owner");
      expect(() =>
        decode({ ...original, data: original.data.subarray(1) })
      ).toThrow("size");
      const broken = Buffer.from(original.data);
      broken[0] = broken[0]! ^ 1;
      expect(() => decode({ ...original, data: broken })).toThrow(
        "discriminator"
      );
      if (decode !== decodeMarket) {
        const wrongMarket = Buffer.from(original.data);
        wrongMarket.fill(0, 32, 64);
        expect(() => decode({ ...original, data: wrongMarket })).toThrow(
          "market"
        );
      } else
        expect(() => decode({ ...original, address: ZERO })).toThrow("market");
    }
  });
});

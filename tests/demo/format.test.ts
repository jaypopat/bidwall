import { expect, test } from "bun:test";
import { usd } from "../../app/lib/story/format.ts";

test("USDC display rounds the verified payment and surplus to cents", () => {
  expect(usd("1014065940", 2)).toBe("1,014.07");
  expect(usd("14065940", 2)).toBe("14.07");
  expect(usd("3685934060", 2)).toBe("3,685.93");
});

test("full precision preserves atoms and missing amounts remain unknown", () => {
  expect(usd("14065940")).toBe("14.065940");
  expect(usd(undefined, 2)).toBe("—");
});

test("rounding retains precision above the safe integer range", () => {
  expect(usd(9_007_199_254_755_993n, 2)).toBe("9,007,199,254.76");
});

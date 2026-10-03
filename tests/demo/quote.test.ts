import { describe, expect, test } from "bun:test";
import { quoteDelivery } from "../../app/lib/demo/quote.ts";
import type { DemoReceipt } from "../../app/lib/demo/types.ts";
import { createJupiterClient } from "../../scripts/quotes/jupiter.ts";
import {
  fakeFetch,
  json,
  NVDAX,
  NO_ROUTE,
  quoteBody,
  tokenEntry,
} from "../quotes/fixtures.ts";

const receipt: DemoReceipt = {
  status: "passed",
  startedAt: "2026-10-03T22:00:00Z",
  upstreamSlot: 449746339,
  fixtureSha256: "a".repeat(64),
  steps: [],
  stages: [],
  settlement: {
    bid: "11111111111111111111111111111111",
    obligation: "11111111111111111111111111111111",
    paidUsdcAtoms: "594633549",
    repaidUsdcAtoms: "566377120",
    borrowerUsdcAtoms: "28256429",
    deliveredNvdaAtoms: "396422366",
    remainingQuantity: "603577634",
    remainingFunds: "905366451",
  },
};
const now = new Date("2026-10-03T23:00:00Z");
function clientFor(body: unknown, status = 200) {
  const fake = fakeFetch((url) =>
    url.pathname.includes("tokens")
      ? json([tokenEntry(NVDAX, "NVDAx", 234.58)])
      : json(body, status)
  );
  return {
    ...fake,
    client: createJupiterClient({ fetch: fake.fetch, sleep: async () => {} }),
  };
}

describe("exact delivered-quantity demo quote", () => {
  test("uses executed atoms, stores output bounds and labels reference time", async () => {
    // Different from the observer's fixed demo lot: the receipt controls quantity.
    const custom = {
      ...receipt,
      settlement: { ...receipt.settlement!, deliveredNvdaAtoms: "396422367" },
    };
    const { client, calls } = clientFor(
      quoteBody(NVDAX, 396422367n, 929639512n)
    );
    const { quote, raw } = await quoteDelivery(custom, client, now);
    expect(new URL(calls[1]!).searchParams.get("amount")).toBe("396422367");
    expect(quote.status).toBe("ok");
    expect(quote.inAmountRaw).toBe("396422367");
    expect(quote.outAmountRaw).toBe("929639512");
    expect(quote.minOutAmountRaw).toBe("924991314");
    expect(quote.referencePriceUsd).toBe("234.58");
    expect(quote.observedAt).toBe(now.toISOString());
    expect(quote.routeLabels).toEqual(["Riptide"]);
    expect(raw).toHaveProperty("exchanges");
  });
  test.each([
    { inputMint: "wrong-mint" },
    { outputMint: NVDAX },
    { inAmount: "396422365" },
    { swapMode: "ExactOut" },
    { outAmount: "0" },
    { otherAmountThreshold: "999999999" },
    { otherAmountThreshold: "1" },
    { contextSlot: 1.5 },
  ])("refuses inconsistent quote %j", async (change) => {
    const { client } = clientFor({
      ...quoteBody(NVDAX, 396422366n, 929639512n),
      ...change,
    });
    const { quote } = await quoteDelivery(receipt, client, now);
    expect(quote.status).toBe("error");
    expect(quote.outAmountRaw).toBeUndefined();
  });
  test("keeps no route distinct from request failure and zero output", async () => {
    const missing = await quoteDelivery(
      receipt,
      clientFor(NO_ROUTE, 400).client,
      now
    );
    const failed = await quoteDelivery(
      receipt,
      clientFor({ error: "unavailable" }, 401).client,
      now
    );
    expect(missing.quote.status).toBe("no-route");
    expect(failed.quote.status).toBe("error");
    expect(missing.quote.outAmountRaw).toBeUndefined();
    expect(failed.quote.outAmountRaw).toBeUndefined();
  });
  test("refuses unexecuted, incomplete and zero-quantity receipts before HTTP", async () => {
    const { client, calls } = clientFor({});
    for (const candidate of [
      { ...receipt, status: "running" as const },
      { ...receipt, settlement: undefined },
      {
        ...receipt,
        settlement: { ...receipt.settlement!, deliveredNvdaAtoms: "0" },
      },
    ])
      await expect(quoteDelivery(candidate, client, now)).rejects.toThrow(
        "passed settlement receipt"
      );
    expect(calls).toEqual([]);
  });
});

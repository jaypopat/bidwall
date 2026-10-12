import { describe, expect, test } from "bun:test";
import { KAMINO_PAIRS } from "../../app/lib/bidwall/kamino.ts";
import { quoteExit } from "../../app/lib/demo/depth.ts";
import { createJupiterClient } from "../../scripts/quotes/jupiter.ts";
import {
  fakeFetch,
  json,
  NO_ROUTE,
  quoteBody,
  tokenEntry,
} from "../quotes/fixtures.ts";

const onyc = KAMINO_PAIRS.onyc;
const now = new Date("2026-10-12T22:00:00Z");
// 5,000,000 USD of ONyc at 1.15, as the module sizes it.
const lot = BigInt(Math.floor((5_000_000 / 1.15) * 1e9));

function clientFor(quote: unknown, price: number | null = 1.15, status = 200) {
  const fake = fakeFetch((url) =>
    url.pathname.includes("tokens")
      ? json(
          price === null
            ? []
            : [tokenEntry(onyc.collateralMint, "ONyc", price, 9)]
        )
      : json(quote, status)
  );
  return {
    ...fake,
    client: createJupiterClient({ fetch: fake.fetch, sleep: async () => {} }),
  };
}

describe("live exit depth", () => {
  test("sizes the lot from the reference price and reports the loss", async () => {
    const { client, calls } = clientFor(
      quoteBody(onyc.collateralMint, lot, 2_850_000_000_000n)
    );
    const depth = await quoteExit(onyc, 5_000_000, client, now);
    expect(new URL(calls[1]!).searchParams.get("amount")).toBe(lot.toString());
    expect(depth.status).toBe("ok");
    expect(depth.impactBps).toBe(4300);
    expect(depth.referencePriceUsd).toBe("1.15");
    expect(depth.observedAt).toBe(now.toISOString());
  });

  test("keeps no route distinct from an error", async () => {
    const missing = await quoteExit(
      onyc,
      5_000_000,
      clientFor(NO_ROUTE, 1.15, 400).client,
      now
    );
    expect(missing.status).toBe("no-route");
    expect(missing.impactBps).toBeUndefined();
  });

  test("refuses to quote without a reference price", async () => {
    const { client, calls } = clientFor({}, null);
    const depth = await quoteExit(onyc, 1_000_000, client, now);
    expect(depth.status).toBe("error");
    expect(calls).toHaveLength(1);
  });

  test("rejects a quote for a different amount", async () => {
    const { client } = clientFor(
      quoteBody(onyc.collateralMint, lot - 1n, 2_850_000_000_000n)
    );
    const depth = await quoteExit(onyc, 5_000_000, client, now);
    expect(depth.status).toBe("error");
    expect(depth.impactBps).toBeUndefined();
  });
});

import { describe, expect, test } from "bun:test";
import { createJupiterClient } from "../../scripts/quotes/jupiter.ts";
import { countOkQuotes, runObservation } from "../../scripts/quotes/observe.ts";
import { TRACKED_TOKENS } from "../../scripts/quotes/tokens.ts";
import type { ObservationDraft } from "../../scripts/quotes/types.ts";
import {
  NO_ROUTE,
  fakeFetch,
  json,
  quoteBody,
  recordingSleep,
  tokenEntry,
} from "./fixtures.ts";

const SATURDAY = new Date("2026-10-03T18:14:26Z");

type Overrides = {
  decimals?: Record<string, number>;
  price?: Record<string, number>;
  omit?: string[];
};

/**
 * Every token is priced at $100, so a lot's USDC value in atoms equals its
 * token atoms. Quotes answer 1% below that value unless a test says otherwise.
 */
function market(
  overrides: Overrides = {},
  answer?: (url: URL, inAmount: bigint) => Response
) {
  const http = fakeFetch((url) => {
    if (url.pathname.includes("/tokens/"))
      return json(
        TRACKED_TOKENS.filter((t) => !overrides.omit?.includes(t.symbol)).map(
          (t) =>
            tokenEntry(
              t.mint,
              t.symbol,
              overrides.price?.[t.symbol] ?? 100,
              overrides.decimals?.[t.symbol] ?? 8
            )
        )
      );
    const inAmount = BigInt(url.searchParams.get("amount") ?? "0");
    if (answer) return answer(url, inAmount);
    return json(
      quoteBody(
        url.searchParams.get("inputMint") ?? "",
        inAmount,
        (inAmount * 99n) / 100n
      )
    );
  });
  const client = createJupiterClient({
    fetch: http.fetch,
    sleep: recordingSleep().sleep,
  });
  const observe = () =>
    runObservation({
      client,
      now: SATURDAY,
      runner: "local",
      pause: async () => {},
    });
  return { observe, calls: http.calls };
}

const token = (observation: ObservationDraft, symbol: string) =>
  observation.tokens.find((t) => t.symbol === symbol);

describe("runObservation", () => {
  test("quotes the demo lot and the dollar ladder for every token", async () => {
    const { observe, calls } = market();
    const { observation, exchanges } = await observe();

    expect(observation).toMatchObject({
      schema: "bidwall.quote-observation/v1",
      label: "Mainnet Jupiter quote, not executed",
      observedAt: "2026-10-03T18:14:26.000Z",
      newYorkTime: "2026-10-03 14:14 EDT",
      session: "weekend",
      runner: "local",
      slippageBps: 50,
    });
    expect(calls).toHaveLength(56); // 1 token lookup + 7 NVDAx lots + 8 tokens × 6
    expect(exchanges).toHaveLength(56);
    expect(countOkQuotes(observation)).toBe(55);

    const nvdax = token(observation, "NVDAx");
    expect(nvdax?.quotes.map((q) => q.lot)).toEqual([
      "demo-lot",
      "usd-10000",
      "usd-50000",
      "usd-100000",
      "usd-250000",
      "usd-500000",
      "usd-1000000",
    ]);
    expect(nvdax?.quotes[0]).toMatchObject({
      inAmountRaw: "396422366",
      notionalUsd: "396.42",
      status: "ok",
      outAmountRaw: "392458142",
      deviationBps: -101, // 0.99 × 396422366 is floored, so it is a hair under 1%
      routeLabels: ["Riptide"],
    });
    expect(nvdax?.quotes[1]).toMatchObject({
      inAmountRaw: "10000000000",
      notionalUsd: "10000.00",
      deviationBps: -100,
    });
    expect(token(observation, "SPYx")?.quotes).toHaveLength(6);
  });

  test("skips a token whose decimals disagree with the allowlist", async () => {
    const { observe, calls } = market({ decimals: { TSLAx: 6 } });
    const { observation } = await observe();
    expect(token(observation, "TSLAx")).toMatchObject({
      status: "skipped",
      skipReason: "Token API reports 6 decimals, expected 8",
      quotes: [],
    });
    expect(calls).toHaveLength(50);
  });

  test("skips a token the token API did not return", async () => {
    const { observe } = market({ omit: ["HOODx"] });
    const { observation } = await observe();
    expect(token(observation, "HOODx")).toMatchObject({
      status: "skipped",
      skipReason: "Not returned by the token API",
    });
  });

  test("skips a token with an unusable reference price", async () => {
    const { observe } = market({ price: { AAPLx: 0 } });
    const { observation } = await observe();
    expect(token(observation, "AAPLx")).toMatchObject({
      status: "skipped",
      skipReason: "Unusable price: 0",
    });
  });

  test("never records a quote that does not echo the request", async () => {
    const { observe } = market({}, (url, inAmount) =>
      json(
        quoteBody(
          url.searchParams.get("inputMint") ?? "",
          inAmount + 1n,
          inAmount
        )
      )
    );
    const { observation } = await observe();
    expect(token(observation, "NVDAx")?.quotes[0]).toMatchObject({
      status: "error",
      error:
        "Quote does not match the request: inAmount asked 396422366, quoted 396422367",
    });
    expect(countOkQuotes(observation)).toBe(0);
  });

  test("never records a quote for a different input token", async () => {
    const { observe } = market({}, (_url, inAmount) =>
      json(quoteBody("SomeOtherMint", inAmount, inAmount))
    );
    const { observation } = await observe();
    expect(token(observation, "SPYx")?.quotes[0]).toMatchObject({
      status: "error",
      error: `Quote does not match the request: inputMint asked ${token(observation, "SPYx")?.mint}, quoted SomeOtherMint`,
    });
  });

  test("never records a quote paid in a different output token or mode", async () => {
    const { observe } = market({}, (url, inAmount) =>
      json({
        ...quoteBody(
          url.searchParams.get("inputMint") ?? "",
          inAmount,
          inAmount
        ),
        outputMint: "So11111111111111111111111111111111111111112",
        swapMode: "ExactOut",
      })
    );
    const { observation } = await observe();
    expect(token(observation, "NVDAx")?.quotes[0]).toMatchObject({
      status: "error",
      error:
        "Quote does not match the request: outputMint asked EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v, quoted So11111111111111111111111111111111111111112",
    });
    expect(countOkQuotes(observation)).toBe(0);
  });

  test("records no-route quotes and keeps going", async () => {
    const { observe } = market({}, () => json(NO_ROUTE, 400));
    const { observation } = await observe();
    expect(
      token(observation, "SPYx")?.quotes.every((q) => q.status === "no-route")
    ).toBe(true);
  });

  test("skips every token when the token lookup fails", async () => {
    const http = fakeFetch(() => json({ error: "Unavailable" }, 500));
    const client = createJupiterClient({
      fetch: http.fetch,
      sleep: recordingSleep().sleep,
    });
    const { observation } = await runObservation({
      client,
      now: SATURDAY,
      runner: "local",
      pause: async () => {},
    });
    expect(
      observation.tokens.every(
        (t) => t.skipReason === "Token lookup failed: HTTP 500: Unavailable"
      )
    ).toBe(true);
    expect(countOkQuotes(observation)).toBe(0);
  });
});

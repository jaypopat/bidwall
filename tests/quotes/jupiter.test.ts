import { describe, expect, test } from "bun:test";
import { createJupiterClient } from "../../scripts/quotes/jupiter.ts";
import { USDC } from "../../scripts/quotes/tokens.ts";
import {
  NO_ROUTE,
  NVDAX,
  fakeFetch,
  json,
  quoteBody,
  recordingSleep,
  tokenEntry,
} from "./fixtures.ts";

const request = {
  inputMint: NVDAX,
  outputMint: USDC.mint,
  amount: 396_422_366n,
  slippageBps: 50,
};

function client(handler: Parameters<typeof fakeFetch>[0]) {
  const http = fakeFetch(handler);
  const pause = recordingSleep();
  return {
    ...http,
    delays: pause.delays,
    jupiter: createJupiterClient({ fetch: http.fetch, sleep: pause.sleep }),
  };
}

describe("getQuote", () => {
  test("parses the live demo-lot quote into exact amounts", async () => {
    const { jupiter, calls } = client(() =>
      json(quoteBody(NVDAX, 396_422_366n, 931_322_087n))
    );
    const result = await jupiter.getQuote(request);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.quote).toEqual({
      inputMint: NVDAX,
      inAmount: 396_422_366n,
      outAmount: 931_322_087n,
      minOutAmount: 926_665_476n,
      priceImpactPct: "0.0002658460553391063286039473",
      contextSlot: 452_986_050,
      routeLabels: ["Riptide"],
    });
    const url = new URL(calls[0] ?? "");
    expect(url.searchParams.get("amount")).toBe("396422366");
    expect(url.searchParams.get("slippageBps")).toBe("50");
    expect(url.searchParams.get("outputMint")).toBe(USDC.mint);
  });

  test("reports no route without retrying", async () => {
    const { jupiter, calls } = client(() => json(NO_ROUTE, 400));
    expect((await jupiter.getQuote(request)).status).toBe("no-route");
    expect(calls).toHaveLength(1);
  });

  test("reports other client errors with Jupiter's message, without retrying", async () => {
    const { jupiter, calls } = client(() =>
      json({ error: "Invalid amount" }, 400)
    );
    const result = await jupiter.getQuote(request);
    expect(result).toMatchObject({
      status: "error",
      error: "HTTP 400: Invalid amount",
    });
    expect(calls).toHaveLength(1);
  });

  test("retries once after a rate limit", async () => {
    let attempts = 0;
    const { jupiter, calls, delays } = client(() =>
      ++attempts === 1
        ? json({ error: "Too many requests" }, 429)
        : json(quoteBody(NVDAX, 1n, 2n))
    );
    expect((await jupiter.getQuote(request)).status).toBe("ok");
    expect(calls).toHaveLength(2);
    expect(delays).toEqual([3_000]);
  });

  test("gives up after a second server error", async () => {
    const { jupiter, calls } = client(() =>
      json({ error: "Unavailable" }, 503)
    );
    expect(await jupiter.getQuote(request)).toMatchObject({
      status: "error",
      error: "HTTP 503: Unavailable",
    });
    expect(calls).toHaveLength(2);
  });

  test("retries once when fetch itself throws, then records the failure", async () => {
    const { jupiter, calls } = client(() => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    const result = await jupiter.getQuote(request);
    expect(result).toMatchObject({
      status: "error",
      error: "Network error: getaddrinfo ENOTFOUND",
    });
    expect(result.exchange.status).toBe("network-error");
    expect(calls).toHaveLength(2);
  });

  test("abandons a request that stalls, retries once, then records the timeout", async () => {
    const http = fakeFetch(() => new Promise<Response>(() => {}));
    const stalled: typeof http.fetch = (url, init) =>
      new Promise((_resolve, reject) => {
        void http.fetch(url);
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason)
        );
      });
    const jupiter = createJupiterClient({
      fetch: stalled,
      sleep: recordingSleep().sleep,
      timeoutMs: 20,
    });
    expect(await jupiter.getQuote(request)).toMatchObject({
      status: "error",
      error: "Network error: timed out after 20 ms",
    });
    expect(http.calls).toHaveLength(2);
  });

  test("rejects a 200 response with a missing amount instead of guessing", async () => {
    const body: Record<string, unknown> = quoteBody(NVDAX, 1n, 2n);
    delete body.outAmount;
    const { jupiter } = client(() => json(body));
    expect(await jupiter.getQuote(request)).toMatchObject({
      status: "error",
      error: "Unexpected quote response: outAmount must be an integer string",
    });
  });
});

describe("getTokens", () => {
  const SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";

  test("looks up every mint in one request and keeps only requested mints", async () => {
    const { jupiter, calls } = client(() =>
      json([
        tokenEntry(NVDAX, "NVDAx", 234.5),
        { id: "SomeOtherMint", symbol: "JUNK", usdPrice: "not a number" },
        tokenEntry(SPYX, "SPYx", 770.86),
      ])
    );
    const result = await jupiter.getTokens([NVDAX, SPYX]);

    expect(new URL(calls[0] ?? "").searchParams.get("query")).toBe(
      `${NVDAX},${SPYX}`
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.tokens.map((t) => t.mint)).toEqual([NVDAX, SPYX]);
    expect(result.tokens[0]).toEqual({
      mint: NVDAX,
      symbol: "NVDAx",
      decimals: 8,
      usdPrice: 234.5,
      priceBlockId: 453_011_061,
      liquidityUsd: 4_707_750.48,
    });
  });

  test("fails the lookup when a requested token is malformed", async () => {
    const { jupiter } = client(() =>
      json([{ ...tokenEntry(NVDAX, "NVDAx", 1), usdPrice: "234.5" }])
    );
    expect(await jupiter.getTokens([NVDAX])).toMatchObject({
      status: "error",
      error: "Unexpected token response: usdPrice must be a finite number",
    });
  });
});

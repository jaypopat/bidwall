import type { FetchLike, Sleep } from "../../scripts/quotes/jupiter.ts";
import { USDC } from "../../scripts/quotes/tokens.ts";

export const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";

/** Shape of a Jupiter token API entry (fields we read, plus realistic extras). */
export function tokenEntry(
  mint: string,
  symbol: string,
  usdPrice: number,
  decimals = 8
) {
  return {
    id: mint,
    symbol,
    name: `${symbol} xStock`,
    decimals,
    usdPrice,
    priceBlockId: 453_011_061,
    liquidity: 4_707_750.48,
    tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  };
}

/** Shape of a Jupiter quote, modelled on the live NVDAx demo-lot response of 3 October. */
export function quoteBody(
  inputMint: string,
  inAmount: bigint,
  outAmount: bigint
) {
  return {
    inputMint,
    inAmount: inAmount.toString(),
    outputMint: USDC.mint,
    outAmount: outAmount.toString(),
    otherAmountThreshold: ((outAmount * 995n) / 1000n).toString(),
    swapMode: "ExactIn",
    slippageBps: 50,
    priceImpactPct: "0.0002658460553391063286039473",
    routePlan: [
      {
        swapInfo: {
          ammKey: "GxGxQBvMQ7vUZWRM6v26umC9w8bCxu4hXTHxCtgEcopa",
          label: "Riptide",
          inputMint,
          outputMint: USDC.mint,
          inAmount: inAmount.toString(),
          outAmount: outAmount.toString(),
        },
        percent: 100,
      },
    ],
    contextSlot: 452_986_050,
    timeTaken: 0.0117,
  };
}

export const NO_ROUTE = {
  error: "No routes found",
  errorCode: "NO_ROUTES_FOUND",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fake fetch that answers from `handler` and records every URL requested. */
export function fakeFetch(handler: (url: URL) => Response | Promise<Response>) {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    return handler(new URL(url));
  };
  return { fetch, calls };
}

/** A sleep that returns immediately and records requested delays. */
export function recordingSleep() {
  const delays: number[] = [];
  const sleep: Sleep = async (ms) => {
    delays.push(ms);
  };
  return { sleep, delays };
}

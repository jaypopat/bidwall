import {
  createJupiterClient,
  type JupiterClient,
} from "../../../scripts/quotes/jupiter.ts";
import { SLIPPAGE_BPS, USDC } from "../../../scripts/quotes/tokens.ts";
import type { KaminoPair } from "../bidwall/kamino";

/** Sale sizes the exit-depth check supports, in USD. */
export const EXIT_SIZES = [100_000, 1_000_000, 5_000_000] as const;
export type ExitSize = (typeof EXIT_SIZES)[number];

export type ExitDepth = {
  status: "ok" | "no-route" | "error";
  observedAt: string;
  symbol: string;
  sizeUsd: ExitSize;
  referencePriceUsd?: string;
  inAmountRaw?: string;
  outAmountRaw?: string;
  /** Loss against the reference price, in basis points (positive = worse). */
  impactBps?: number;
  routeLabels?: string[];
  contextSlot?: number;
};

/** Live Jupiter sell quote for `sizeUsd` worth of the pair's collateral into USDC.
 * Read-only: it never builds or sends a swap.
 */
export async function quoteExit(
  pair: KaminoPair,
  sizeUsd: ExitSize,
  client: JupiterClient,
  now = new Date()
): Promise<ExitDepth> {
  const base: ExitDepth = {
    status: "error",
    observedAt: now.toISOString(),
    symbol: pair.symbol,
    sizeUsd,
  };
  const lookup = await client.getTokens([pair.collateralMint]);
  const token =
    lookup.status === "ok"
      ? lookup.tokens.find(
          (t) => t.mint === pair.collateralMint && t.decimals === pair.decimals
        )
      : undefined;
  if (!token || !Number.isFinite(token.usdPrice) || token.usdPrice <= 0)
    return base;
  const amount = BigInt(
    Math.floor((sizeUsd / token.usdPrice) * 10 ** pair.decimals)
  );
  const result = await client.getQuote({
    inputMint: pair.collateralMint,
    outputMint: USDC.mint,
    amount,
    slippageBps: SLIPPAGE_BPS,
  });
  const quoted = {
    ...base,
    referencePriceUsd: token.usdPrice.toString(),
    inAmountRaw: amount.toString(),
  };
  if (result.status === "no-route") return { ...quoted, status: "no-route" };
  if (result.status !== "ok") return quoted;
  const q = result.quote;
  if (
    q.inputMint !== pair.collateralMint ||
    q.outputMint !== USDC.mint ||
    q.swapMode !== "ExactIn" ||
    q.inAmount !== amount ||
    q.outAmount <= 0n
  )
    return quoted;
  // The amount was sized from the reference price, so it is worth sizeUsd.
  const expected = BigInt(sizeUsd) * 1_000_000n;
  return {
    ...quoted,
    status: "ok",
    outAmountRaw: q.outAmount.toString(),
    impactBps: Number(((expected - q.outAmount) * 10_000n) / expected),
    routeLabels: q.routeLabels,
    contextSlot: q.contextSlot,
  };
}

const cache = new Map<string, { at: number; value: Promise<ExitDepth> }>();
const TTL_MS = 60_000;

/** Shares one live quote per pair and size for a minute. */
export function cachedExit(pair: KaminoPair, sizeUsd: ExitSize) {
  const key = `${pair.id}:${sizeUsd}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const client = createJupiterClient({
    fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  const value = quoteExit(pair, sizeUsd, client).catch(() => {
    cache.delete(key);
    throw new Error("Exit quote failed");
  });
  cache.set(key, { at: Date.now(), value });
  return value;
}

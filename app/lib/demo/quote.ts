import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import {
  createJupiterClient,
  type JupiterClient,
} from "../../../scripts/quotes/jupiter.ts";
import {
  SLIPPAGE_BPS,
  TRACKED_TOKENS,
  USDC,
} from "../../../scripts/quotes/tokens.ts";
import type { DemoQuote, DemoReceipt } from "./types";

const inputMint = TRACKED_TOKENS.find(
  (token) => token.symbol === "NVDAx"
)!.mint;
const directory = resolve(process.cwd(), "build/demo");
const latestPath = resolve(directory, "quote.json");

/** Quote only the executed delivery, never a rounded or symbol-matched lot. */
export async function quoteDelivery(
  receipt: DemoReceipt,
  client: JupiterClient,
  now = new Date()
): Promise<{ quote: Omit<DemoQuote, "rawSha256" | "rawPath">; raw: unknown }> {
  if (
    receipt.status !== "passed" ||
    !receipt.settlement ||
    BigInt(receipt.settlement.deliveredNvdaAtoms) <= 0n
  )
    throw new Error("A passed settlement receipt is required");
  const amount = BigInt(receipt.settlement.deliveredNvdaAtoms);
  const lookup = await client.getTokens([inputMint]);
  const result = await client.getQuote({
    inputMint,
    outputMint: USDC.mint,
    amount,
    slippageBps: SLIPPAGE_BPS,
  });
  const quote: Omit<DemoQuote, "rawSha256" | "rawPath"> = {
    status: result.status,
    observedAt: now.toISOString(),
    inputMint,
    outputMint: USDC.mint,
    inputDecimals: 8,
    outputDecimals: 6,
    inAmountRaw: amount.toString(),
    slippageBps: SLIPPAGE_BPS,
  };
  if (lookup.status === "ok") {
    const token = lookup.tokens.find(
      (token) => token.mint === inputMint && token.decimals === 8
    );
    if (token && Number.isFinite(token.usdPrice) && token.usdPrice > 0)
      quote.referencePriceUsd = token.usdPrice.toString();
  }
  if (result.status === "ok") {
    const q = result.quote;
    // The generic observer parser reads shapes; this exact-lot boundary also
    // verifies identities, mode, amount and economically valid output bounds.
    if (
      q.inputMint !== inputMint ||
      q.outputMint !== USDC.mint ||
      q.swapMode !== "ExactIn" ||
      q.inAmount !== amount ||
      q.outAmount <= 0n ||
      q.minOutAmount < 0n ||
      q.minOutAmount <
        (q.outAmount * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n ||
      q.minOutAmount > q.outAmount ||
      !Number.isSafeInteger(q.contextSlot) ||
      q.contextSlot < 0
    ) {
      quote.status = "error";
    } else {
      Object.assign(quote, {
        outAmountRaw: q.outAmount.toString(),
        minOutAmountRaw: q.minOutAmount.toString(),
        contextSlot: q.contextSlot,
        routeLabels: q.routeLabels,
        priceImpactPct: q.priceImpactPct,
      });
    }
  }
  return {
    quote,
    raw: {
      observedAt: quote.observedAt,
      receiptStartedAt: receipt.startedAt,
      bid: receipt.settlement.bid,
      exchanges: [lookup.exchange, result.exchange],
    },
  };
}

export async function refreshDeliveryQuote(
  receipt: DemoReceipt
): Promise<DemoQuote> {
  const client = createJupiterClient({
    fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  const result = await quoteDelivery(receipt, client);
  const bytes = gzipSync(JSON.stringify(result.raw));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const rawPath = `quote-${result.quote.observedAt.replaceAll(":", "-")}-${sha256.slice(0, 12)}.json.gz`;
  const quote: DemoQuote = { ...result.quote, rawSha256: sha256, rawPath };
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, rawPath), bytes);
  await writeFile(
    `${latestPath}.tmp`,
    JSON.stringify({
      receiptStartedAt: receipt.startedAt,
      bid: receipt.settlement!.bid,
      quote,
    })
  );
  await rename(`${latestPath}.tmp`, latestPath);
  return quote;
}

/** Stored quotes are tied to this run and delivered lot; polling never requests Jupiter. */
export async function readDeliveryQuote(
  receipt: DemoReceipt
): Promise<DemoQuote | undefined> {
  try {
    if (!receipt.settlement || receipt.status !== "passed") return undefined;
    const saved = JSON.parse(await readFile(latestPath, "utf8"));
    const q = saved.quote as DemoQuote;
    if (
      saved.receiptStartedAt !== receipt.startedAt ||
      saved.bid !== receipt.settlement?.bid ||
      q.inAmountRaw !== receipt.settlement.deliveredNvdaAtoms ||
      q.inputMint !== inputMint ||
      q.outputMint !== USDC.mint ||
      q.inputDecimals !== 8 ||
      q.outputDecimals !== 6 ||
      q.slippageBps !== SLIPPAGE_BPS ||
      !["ok", "no-route", "error"].includes(q.status) ||
      !Number.isFinite(Date.parse(q.observedAt)) ||
      !/^quote-[\w.:-]+\.json\.gz$/.test(q.rawPath) ||
      !/^[a-f0-9]{64}$/.test(q.rawSha256)
    )
      return undefined;
    if (
      q.status === "ok" &&
      (!/^\d+$/.test(q.outAmountRaw ?? "") ||
        !/^\d+$/.test(q.minOutAmountRaw ?? "") ||
        BigInt(q.outAmountRaw!) <= 0n ||
        BigInt(q.minOutAmountRaw!) > BigInt(q.outAmountRaw!) ||
        BigInt(q.minOutAmountRaw!) <
          (BigInt(q.outAmountRaw!) * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n ||
        !Number.isSafeInteger(q.contextSlot) ||
        !Array.isArray(q.routeLabels) ||
        !q.routeLabels.every((label) => typeof label === "string"))
    )
      return undefined;
    const raw = await readFile(resolve(directory, q.rawPath));
    if (createHash("sha256").update(raw).digest("hex") !== q.rawSha256)
      return undefined;
    return q;
  } catch {
    return undefined;
  }
}

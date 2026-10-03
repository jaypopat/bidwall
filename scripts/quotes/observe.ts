import { parseArgs } from "node:util";
import type {
  JupiterClient,
  Quote,
  QuoteResult,
  RawExchange,
  TokenInfo,
  TokensResult,
} from "./jupiter.ts";
import { JUPITER_ENDPOINTS, createJupiterClient } from "./jupiter.ts";
import { classifySession, newYorkClock } from "./session.ts";
import { saveObservation } from "./store.ts";
import {
  DEMO_LOT,
  SLIPPAGE_BPS,
  TRACKED_TOKENS,
  USD_LADDER,
  USDC,
  type TrackedToken,
} from "./tokens.ts";
import type {
  Lot,
  ObservationDraft,
  QuoteObservation,
  Runner,
  TokenObservation,
} from "./types.ts";
import {
  atomsForUsd,
  centsForAtoms,
  deviationBps,
  formatCents,
  parsePrice,
} from "./units.ts";

export type ObserveDeps = {
  client: JupiterClient;
  now: Date;
  runner: Runner;
  /** Called before each quote request to pace traffic. */
  pause: () => Promise<void>;
};

type PlannedLot = { lot: Lot; atoms: bigint };

/** Quotes every tracked token once and returns the record plus every raw exchange. */
export async function runObservation(deps: ObserveDeps) {
  const exchanges: RawExchange[] = [];
  const lookup = await deps.client.getTokens(TRACKED_TOKENS.map((t) => t.mint));
  exchanges.push(lookup.exchange);

  const tokens: TokenObservation[] = [];
  for (const tracked of TRACKED_TOKENS) {
    tokens.push(await observeToken(tracked, lookup, deps, exchanges));
  }

  const observation: ObservationDraft = {
    schema: "bidwall.quote-observation/v1",
    label: "Mainnet Jupiter quote, not executed",
    observedAt: deps.now.toISOString(),
    newYorkTime: newYorkClock(deps.now).label,
    session: classifySession(deps.now),
    runner: deps.runner,
    slippageBps: SLIPPAGE_BPS,
    endpoints: JUPITER_ENDPOINTS,
    tokens,
  };
  return { observation, exchanges };
}

export function countOkQuotes(observation: ObservationDraft): number {
  return observation.tokens
    .flatMap((t) => t.quotes)
    .filter((q) => q.status === "ok").length;
}

async function observeToken(
  tracked: TrackedToken,
  lookup: TokensResult,
  deps: ObserveDeps,
  exchanges: RawExchange[]
): Promise<TokenObservation> {
  const skip = (skipReason: string): TokenObservation => ({
    ...tracked,
    status: "skipped",
    skipReason,
    quotes: [],
  });

  if (lookup.status === "error")
    return skip(`Token lookup failed: ${lookup.error}`);
  const info = lookup.tokens.find((t) => t.mint === tracked.mint);
  if (!info) return skip("Not returned by the token API");
  if (info.decimals !== tracked.decimals)
    return skip(
      `Token API reports ${info.decimals} decimals, expected ${tracked.decimals}`
    );

  let price: bigint;
  try {
    price = parsePrice(info.usdPrice);
  } catch (error) {
    return skip(error instanceof Error ? error.message : String(error));
  }

  const quotes: QuoteObservation[] = [];
  for (const planned of plannedLots(tracked, price)) {
    await deps.pause();
    const result = await deps.client.getQuote({
      inputMint: tracked.mint,
      outputMint: USDC.mint,
      amount: planned.atoms,
      slippageBps: SLIPPAGE_BPS,
    });
    exchanges.push(result.exchange);
    quotes.push(toQuoteObservation(tracked, price, planned, result));
  }
  return { ...tracked, status: "ok", ...referenceOf(info), quotes };
}

/** The demo lot (NVDAx only) followed by the dollar ladder. */
function plannedLots(tracked: TrackedToken, price: bigint): PlannedLot[] {
  const ladder = USD_LADDER.map((usd): PlannedLot => ({
    lot: `usd-${Number(usd)}`,
    atoms: atomsForUsd(usd, tracked.decimals, price),
  }));
  return tracked.symbol === DEMO_LOT.symbol
    ? [{ lot: "demo-lot", atoms: DEMO_LOT.atoms }, ...ladder]
    : ladder;
}

function toQuoteObservation(
  tracked: TrackedToken,
  price: bigint,
  planned: PlannedLot,
  result: QuoteResult
): QuoteObservation {
  const base = {
    lot: planned.lot,
    inAmountRaw: planned.atoms.toString(),
    notionalUsd: formatCents(
      centsForAtoms(planned.atoms, tracked.decimals, price)
    ),
  };
  if (result.status === "no-route") return { ...base, status: "no-route" };
  if (result.status === "error")
    return { ...base, status: "error", error: result.error };

  const { quote } = result;
  const mismatch = requestMismatch(tracked, planned, quote);
  if (mismatch)
    return {
      ...base,
      status: "error",
      error: `Quote does not match the request: ${mismatch}`,
    };

  return {
    ...base,
    status: "ok",
    outAmountRaw: quote.outAmount.toString(),
    minOutAmountRaw: quote.minOutAmount.toString(),
    deviationBps: deviationBps(
      { atoms: planned.atoms, decimals: tracked.decimals },
      { atoms: quote.outAmount, decimals: USDC.decimals },
      price
    ),
    priceImpactPct: quote.priceImpactPct,
    contextSlot: quote.contextSlot,
    routeLabels: quote.routeLabels,
  };
}

/** The first field where Jupiter's quote differs from what we asked for, if any. */
function requestMismatch(
  tracked: TrackedToken,
  planned: PlannedLot,
  quote: Quote
): string | null {
  const expected: [field: string, asked: string, quoted: string][] = [
    ["inputMint", tracked.mint, quote.inputMint],
    ["outputMint", USDC.mint, quote.outputMint],
    ["swapMode", "ExactIn", quote.swapMode],
    ["inAmount", planned.atoms.toString(), quote.inAmount.toString()],
  ];
  const differing = expected.find(([, asked, quoted]) => asked !== quoted);
  return differing
    ? `${differing[0]} asked ${differing[1]}, quoted ${differing[2]}`
    : null;
}

function referenceOf(info: TokenInfo) {
  return {
    referencePriceUsd: String(info.usdPrice),
    priceBlockId: info.priceBlockId,
    liquidityUsd: info.liquidityUsd === null ? null : String(info.liquidityUsd),
  };
}

const PAUSE_MS = 1_000;
const USAGE =
  "Usage: bun scripts/quotes/observe.ts --out <data dir> [--runner local|github-actions]";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function parseRunner(value: string | undefined): Runner {
  if (value === "local" || value === "github-actions") return value;
  throw new Error(`Unknown runner "${value}". ${USAGE}`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      runner: { type: "string", default: "local" },
    },
  });
  if (!values.out) throw new Error(USAGE);

  const client = createJupiterClient({
    fetch: (url, init) =>
      fetch(url, { ...init, headers: { accept: "application/json" } }),
    sleep,
  });
  const { observation, exchanges } = await runObservation({
    client,
    now: new Date(),
    runner: parseRunner(values.runner),
    pause: () => sleep(PAUSE_MS),
  });
  const saved = saveObservation(values.out, observation, exchanges);

  console.log(
    `${saved.observedAt} (${saved.session}, ${saved.newYorkTime}) -> ${saved.raw.path}`
  );
  for (const token of saved.tokens) {
    const ok = token.quotes.filter((q) => q.status === "ok").length;
    console.log(
      `  ${token.symbol}: ${token.skipReason ?? `${ok}/${token.quotes.length} quotes ok`}`
    );
  }
  if (countOkQuotes(saved) === 0) {
    console.error("No quote succeeded in this run.");
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();

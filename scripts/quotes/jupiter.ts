import {
  ShapeError,
  readArray,
  readIntegerString,
  readNumber,
  readOptionalNumber,
  readRecord,
  readString,
} from "./validate.ts";

/** Jupiter's free endpoints. Quotes only: nothing here builds or sends a swap. */
export const JUPITER_ENDPOINTS = {
  quote: "https://lite-api.jup.ag/swap/v1/quote",
  tokens: "https://lite-api.jup.ag/tokens/v2/search",
} as const;

const RETRY_DELAY_MS = 3_000;
const TIMEOUT_MS = 15_000;
const NO_ROUTE_CODES = new Set(["NO_ROUTES_FOUND", "COULD_NOT_FIND_ANY_ROUTE"]);

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal }
) => Promise<Response>;
export type Sleep = (ms: number) => Promise<void>;

/** One HTTP request and its response, kept verbatim as evidence. */
export type RawExchange = {
  url: string;
  status: number | "network-error";
  body: unknown;
};

export type TokenInfo = {
  mint: string;
  symbol: string;
  decimals: number;
  usdPrice: number;
  priceBlockId: number | null;
  liquidityUsd: number | null;
};

export type Quote = {
  inputMint: string;
  outputMint: string;
  swapMode: string;
  inAmount: bigint;
  outAmount: bigint;
  minOutAmount: bigint;
  priceImpactPct: string;
  contextSlot: number;
  routeLabels: string[];
};

export type QuoteRequest = {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps: number;
};

export type TokensResult =
  | { status: "ok"; tokens: TokenInfo[]; exchange: RawExchange }
  | { status: "error"; error: string; exchange: RawExchange };

export type QuoteResult =
  | { status: "ok"; quote: Quote; exchange: RawExchange }
  | { status: "no-route"; exchange: RawExchange }
  | { status: "error"; error: string; exchange: RawExchange };

export type JupiterClient = {
  getTokens(mints: readonly string[]): Promise<TokensResult>;
  getQuote(request: QuoteRequest): Promise<QuoteResult>;
};

export function createJupiterClient(options: {
  fetch: FetchLike;
  sleep: Sleep;
  retryDelayMs?: number;
  timeoutMs?: number;
}): JupiterClient {
  const {
    fetch,
    sleep,
    retryDelayMs = RETRY_DELAY_MS,
    timeoutMs = TIMEOUT_MS,
  } = options;

  async function attempt(url: string): Promise<RawExchange> {
    try {
      // The signal also bounds reading the body, so a stalled response cannot hang the run.
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      return { url, status: response.status, body: parseJson(text) };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      const reason = timedOut
        ? `timed out after ${timeoutMs} ms`
        : errorMessage(error);
      return { url, status: "network-error", body: reason };
    }
  }

  /** Retries once on rate limits, server errors and network failures. */
  async function request(url: string): Promise<RawExchange> {
    const first = await attempt(url);
    if (!isRetryable(first.status)) return first;
    await sleep(retryDelayMs);
    return attempt(url);
  }

  return {
    async getTokens(mints) {
      const url = `${JUPITER_ENDPOINTS.tokens}?query=${mints.join(",")}`;
      const exchange = await request(url);
      if (exchange.status !== 200)
        return { status: "error", error: describeFailure(exchange), exchange };
      try {
        if (!Array.isArray(exchange.body))
          throw new ShapeError("body must be an array");
        const requested = exchange.body.filter((entry) =>
          mints.includes(idOf(entry))
        );
        return { status: "ok", tokens: requested.map(parseToken), exchange };
      } catch (error) {
        return {
          status: "error",
          error: `Unexpected token response: ${errorMessage(error)}`,
          exchange,
        };
      }
    },

    async getQuote({ inputMint, outputMint, amount, slippageBps }) {
      const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount: amount.toString(),
        slippageBps: slippageBps.toString(),
      });
      const exchange = await request(`${JUPITER_ENDPOINTS.quote}?${params}`);
      if (exchange.status === 200) {
        try {
          return { status: "ok", quote: parseQuote(exchange.body), exchange };
        } catch (error) {
          return {
            status: "error",
            error: `Unexpected quote response: ${errorMessage(error)}`,
            exchange,
          };
        }
      }
      if (
        exchange.status === 400 &&
        NO_ROUTE_CODES.has(fieldOf(exchange.body, "errorCode"))
      )
        return { status: "no-route", exchange };
      return { status: "error", error: describeFailure(exchange), exchange };
    },
  };
}

function parseToken(value: unknown): TokenInfo {
  const token = readRecord(value, "token");
  return {
    mint: readString(token, "id"),
    symbol: readString(token, "symbol"),
    decimals: readNumber(token, "decimals"),
    usdPrice: readNumber(token, "usdPrice"),
    priceBlockId: readOptionalNumber(token, "priceBlockId"),
    liquidityUsd: readOptionalNumber(token, "liquidity"),
  };
}

function parseQuote(value: unknown): Quote {
  const quote = readRecord(value, "quote");
  return {
    inputMint: readString(quote, "inputMint"),
    outputMint: readString(quote, "outputMint"),
    swapMode: readString(quote, "swapMode"),
    inAmount: readIntegerString(quote, "inAmount"),
    outAmount: readIntegerString(quote, "outAmount"),
    minOutAmount: readIntegerString(quote, "otherAmountThreshold"),
    priceImpactPct: readString(quote, "priceImpactPct"),
    contextSlot: readNumber(quote, "contextSlot"),
    routeLabels: readArray(quote, "routePlan").map((step) =>
      readString(
        readRecord(readRecord(step, "route step").swapInfo, "swapInfo"),
        "label"
      )
    ),
  };
}

function isRetryable(status: RawExchange["status"]): boolean {
  return status === "network-error" || status === 429 || status >= 500;
}

function describeFailure(exchange: RawExchange): string {
  if (exchange.status === "network-error")
    return `Network error: ${String(exchange.body)}`;
  const detail = fieldOf(exchange.body, "error");
  return detail
    ? `HTTP ${exchange.status}: ${detail}`
    : `HTTP ${exchange.status}`;
}

/** A string field of an object body, or "" when absent. */
function fieldOf(body: unknown, key: string): string {
  if (typeof body !== "object" || body === null) return "";
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

const idOf = (entry: unknown) => fieldOf(entry, "id");

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

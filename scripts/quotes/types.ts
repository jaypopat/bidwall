import type { JUPITER_ENDPOINTS } from "./jupiter.ts";
import type { Session } from "./session.ts";

/** The stored schema. Bigints are serialized as decimal strings. */
export type Runner = "github-actions" | "local";
export type Lot = "demo-lot" | `usd-${number}`;

export type QuoteObservation = {
  lot: Lot;
  inAmountRaw: string;
  notionalUsd: string; // value of the lot at the reference price, in dollars
  status: "ok" | "no-route" | "error";
  error?: string;
  outAmountRaw?: string;
  minOutAmountRaw?: string; // Jupiter's otherAmountThreshold
  deviationBps?: number;
  priceImpactPct?: string;
  contextSlot?: number;
  routeLabels?: string[];
};

export type TokenObservation = {
  symbol: string;
  mint: string;
  decimals: number;
  status: "ok" | "skipped";
  skipReason?: string;
  referencePriceUsd?: string;
  priceBlockId?: number | null;
  liquidityUsd?: string | null;
  quotes: QuoteObservation[];
};

export type ObservationDraft = {
  schema: "bidwall.quote-observation/v1";
  label: "Mainnet Jupiter quote, not executed";
  observedAt: string;
  newYorkTime: string;
  session: Session;
  runner: Runner;
  slippageBps: number;
  endpoints: typeof JUPITER_ENDPOINTS;
  tokens: TokenObservation[];
};

export type Observation = ObservationDraft & {
  raw: { path: string; sha256: string };
};

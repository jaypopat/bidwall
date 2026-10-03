import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  MARKET,
  PROGRAM,
  SF,
  USD,
  type Account,
  type Loan,
  type Market,
  type Reserve,
} from "../../scripts/risk/kamino.ts";
import { TRACKED_TOKENS, USD_LADDER } from "../../scripts/quotes/tokens.ts";
import type { TokenObservation } from "../../scripts/quotes/types.ts";

type StoredAccount = { owner: string; data: [string, "base64"] };
export const fixture = JSON.parse(
  gunzipSync(
    readFileSync(new URL("./fixtures/mainnet.json.gz", import.meta.url))
  ).toString()
) as {
  capturedAt: string;
  slot: number;
  reserveSlot: number;
  market: { address: string; account: StoredAccount };
  reserves: { address: string; account: StoredAccount }[];
  loans: { pubkey: string; account: StoredAccount }[];
};
export function account(row: {
  address: string;
  account: StoredAccount;
}): Account {
  return {
    address: row.address,
    owner: row.account.owner,
    data: Buffer.from(row.account.data[0], "base64"),
  };
}
export const stock = TRACKED_TOKENS.find((t) => t.symbol === "NVDAx")!;
export const otherStock = TRACKED_TOKENS.find((t) => t.symbol === "GOOGLx")!;

export function reserve(overrides: Partial<Reserve> = {}): Reserve {
  return {
    address: stock.mint,
    mint: stock.mint,
    symbol: "NVDAx",
    decimals: 0,
    lastUpdateSlot: "100",
    priceUpdatedAt: "0",
    availableAtoms: 1000n,
    borrowedSf: 0n,
    feesSf: 0n,
    collateralSupply: 1000n,
    priceSf: 100n * SF,
    liquidationThresholdPct: 65,
    minBonusBps: 500,
    borrowFactorPct: 100n,
    ...overrides,
  };
}
export function debtReserve(overrides: Partial<Reserve> = {}): Reserve {
  return reserve({
    address: MARKET,
    mint: MARKET,
    symbol: "USDC",
    priceSf: SF,
    ...overrides,
  });
}
export function loan(overrides: Partial<Loan> = {}): Loan {
  return {
    address: PROGRAM,
    owner: MARKET,
    lastUpdateSlot: "100",
    elevationGroup: 0,
    deposits: [{ reserve: stock.mint, ctokens: 10n }],
    borrows: [{ reserve: MARKET, borrowedSf: 600n * SF }],
    ...overrides,
  };
}
export const market: Market = {
  closeFactorPct: 20,
  insolvencyLtvPct: 95,
  minFullLiquidationUsd: 2n * USD,
  maxRepayUsd: 1_000_000n * USD,
  emergencyMode: false,
  priceLiquidationDisabled: false,
};
export function quoteToken(deviations: number[]): TokenObservation {
  return {
    ...stock,
    status: "ok",
    quotes: USD_LADDER.map((usd, i) => ({
      lot: `usd-${Number(usd)}`,
      inAmountRaw: (usd * 1_000_000n).toString(),
      notionalUsd: `${usd}.00`,
      status: "ok",
      deviationBps: deviations[i] ?? deviations.at(-1)!,
    })),
  };
}

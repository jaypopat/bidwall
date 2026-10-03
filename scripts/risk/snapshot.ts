import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { classifySession, type Session } from "../quotes/session.ts";
import { rawFileName } from "../quotes/store.ts";
import { USD_LADDER } from "../quotes/tokens.ts";
import type {
  ObservationDraft,
  QuoteObservation,
  TokenObservation,
} from "../quotes/types.ts";
import {
  readArray,
  readIntegerString,
  readNumber,
  readRecord,
  readString,
} from "../quotes/validate.ts";
import {
  decodeLoan,
  decodeMarket,
  decodeReserve,
  MARKET,
  type Loan,
  type Reserve,
} from "./kamino.ts";
import { createRpcClient, type RpcClient } from "./rpc.ts";
import {
  oraclePriceUsd,
  runScenarios,
  type ScenarioResult,
} from "./scenarios.ts";
import { formatUsd, valueLoan } from "./valuation.ts";

export type RiskSnapshot = {
  schema: "bidwall.risk-snapshot/v1";
  status: "ok";
  label: "Mainnet stress estimate, not an executed liquidation";
  observedAt: string;
  session: Session;
  rpcHost: string;
  market: string;
  slot: number;
  reserveSlot: number;
  loansRead: number;
  loansModelled: number;
  loansNotModelled: { reason: string; count: number }[];
  quoteObservedAt: string | null;
  quoteAgeSeconds: number | null;
  quoteIssue: string | null;
  marketConfig: {
    closeFactorPct: number;
    insolvencyLtvPct: number;
    minFullLiquidationUsd: string;
    maxRepayUsd: string;
    emergencyMode: boolean;
    priceLiquidationDisabled: boolean;
  };
  reserves: {
    address: string;
    mint: string;
    symbol: string;
    oraclePriceUsd: string;
    priceUpdatedAt: string;
    lastUpdateSlot: string;
  }[];
  scenarios: ScenarioResult[];
  raw: { path: string; sha256: string } | null;
};
export type RiskError = {
  schema: "bidwall.risk-snapshot/v1";
  status: "error";
  observedAt: string;
  session: Session;
  rpcHost: string;
  error: string;
};

const stringify = (value: unknown) =>
  JSON.stringify(value, (_, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v
  );

/** Validates the stored fields used by the model; the mint, never the symbol, identifies an asset. */
export function parseQuoteEvidence(value: unknown): ObservationDraft {
  const record = readRecord(value, "quote observation");
  if (record.schema !== "bidwall.quote-observation/v1")
    throw new Error("Unknown quote schema");
  const observedAt = readString(record, "observedAt");
  if (!Number.isFinite(Date.parse(observedAt)))
    throw new Error("Invalid quote timestamp");
  const tokens = readArray(record, "tokens").map((value): TokenObservation => {
    const token = readRecord(value, "token");
    const status = readString(token, "status");
    if (status !== "ok" && status !== "skipped")
      throw new Error("Invalid token status");
    const decimals = readNumber(token, "decimals");
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)
      throw new Error("Invalid token decimals");
    const quotes = readArray(token, "quotes").map((value): QuoteObservation => {
      const quote = readRecord(value, "quote");
      const lot = readString(quote, "lot");
      if (lot !== "demo-lot" && !USD_LADDER.some((usd) => lot === `usd-${usd}`))
        throw new Error("Invalid quote lot");
      const status = readString(quote, "status");
      if (status !== "ok" && status !== "error" && status !== "no-route")
        throw new Error("Invalid quote status");
      const inAmountRaw = readIntegerString(quote, "inAmountRaw").toString();
      const deviationBps =
        status === "ok" ? readNumber(quote, "deviationBps") : undefined;
      if (deviationBps !== undefined && !Number.isSafeInteger(deviationBps))
        throw new Error("Invalid quote deviation");
      return {
        lot: lot as QuoteObservation["lot"],
        status,
        inAmountRaw,
        notionalUsd: readString(quote, "notionalUsd"),
        deviationBps,
      };
    });
    if (new Set(quotes.map((q) => q.lot)).size !== quotes.length)
      throw new Error("Duplicate quote lot");
    return {
      symbol: readString(token, "symbol"),
      mint: readString(token, "mint"),
      decimals,
      status,
      quotes,
    };
  });
  if (new Set(tokens.map((t) => t.mint)).size !== tokens.length)
    throw new Error("Duplicate quote mint");
  return { ...record, observedAt, tokens } as ObservationDraft;
}

export function readLatestQuotes(dir: string): {
  quotes: ObservationDraft | null;
  issue: string | null;
} {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
      .sort()
      .reverse();
  } catch {
    return { quotes: null, issue: "Quote evidence directory is unavailable" };
  }
  let malformed = false;
  for (const name of names) {
    let lines: string[];
    try {
      lines = readFileSync(join(dir, name), "utf8")
        .split("\n")
        .filter((line) => line.trim())
        .reverse();
    } catch {
      malformed = true;
      continue;
    }
    for (const line of lines) {
      try {
        return {
          quotes: parseQuoteEvidence(JSON.parse(line)),
          issue: malformed
            ? "Skipped unreadable or malformed quote evidence"
            : null,
        };
      } catch {
        malformed = true;
      }
    }
  }
  return {
    quotes: null,
    issue: malformed
      ? "No valid quote evidence found"
      : "No quote observations found",
  };
}

export async function buildSnapshot(deps: {
  rpc: RpcClient;
  quotes: ObservationDraft | null;
  now?: Date;
  quoteIssue?: string | null;
}) {
  const now = deps.now ?? new Date();
  const observedAt = now.toISOString();
  const source = await deps.rpc.getLoans();
  const excluded: { address: string; reason: string }[] = [];
  const loans: Loan[] = [];
  for (const account of source.accounts) {
    try {
      loans.push(decodeLoan(account));
    } catch (error) {
      excluded.push({
        address: account.address,
        reason: error instanceof Error ? error.message : "Invalid obligation",
      });
    }
  }
  const reserveAddresses = [
    ...new Set(
      loans.flatMap((l) => [
        ...l.deposits.map((d) => d.reserve),
        ...l.borrows.map((b) => b.reserve),
      ])
    ),
  ].sort();
  const configSource = await deps.rpc.getAccounts(
    [MARKET, ...reserveAddresses],
    source.slot
  );
  const marketAccount = configSource.accounts[0];
  if (!marketAccount) throw new Error("Missing market account");
  const market = decodeMarket(marketAccount);
  const reserves = new Map<string, Reserve>();
  for (const account of configSource.accounts.slice(1))
    reserves.set(account.address, decodeReserve(account));
  const modelled: Loan[] = [];
  const loanRows = loans.map((loan) => {
    try {
      const valued = valueLoan(loan, reserves);
      modelled.push(loan);
      return {
        ...loan,
        deposits: valued.deposits.map((d, i) => ({
          ...loan.deposits[i],
          mint: d.reserve.mint,
          symbol: d.reserve.symbol,
          atoms: d.atoms.toString(),
          valueUsd: formatUsd(d.valueUsd),
        })),
        borrows: valued.debts.map((d, i) => ({
          ...loan.borrows[i],
          mint: d.reserve.mint,
          symbol: d.reserve.symbol,
          atoms: d.atoms.toString(),
          valueUsd: formatUsd(d.valueUsd),
        })),
        health: {
          depositUsd: formatUsd(valued.depositUsd),
          debtUsd: formatUsd(valued.debtUsd),
          adjustedDebtUsd: formatUsd(valued.adjustedDebtUsd),
          thresholdUsd: formatUsd(valued.thresholdUsd),
          liquidatable: valued.liquidatable,
        },
      };
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Cannot value loan";
      excluded.push({ address: loan.address, reason });
      return { ...loan, notModelled: reason };
    }
  });
  const reasons = new Map<string, number>();
  for (const row of excluded)
    reasons.set(row.reason, (reasons.get(row.reason) ?? 0) + 1);
  let quotes = deps.quotes;
  let quoteIssue = deps.quoteIssue ?? null;
  if (quotes && Date.parse(quotes.observedAt) > now.getTime()) {
    quotes = null;
    quoteIssue =
      "Quote observation is newer than the snapshot; depth is unknown";
  }
  const snapshot: RiskSnapshot = {
    schema: "bidwall.risk-snapshot/v1",
    status: "ok",
    label: "Mainnet stress estimate, not an executed liquidation",
    observedAt,
    session: classifySession(now),
    rpcHost: deps.rpc.host,
    market: MARKET,
    slot: source.slot,
    reserveSlot: configSource.slot,
    loansRead: source.accounts.length,
    loansModelled: modelled.length,
    loansNotModelled: [...reasons].map(([reason, count]) => ({
      reason,
      count,
    })),
    quoteObservedAt: quotes?.observedAt ?? null,
    quoteAgeSeconds: quotes
      ? Math.floor((now.getTime() - Date.parse(quotes.observedAt)) / 1000)
      : null,
    quoteIssue,
    marketConfig: {
      ...market,
      minFullLiquidationUsd: formatUsd(market.minFullLiquidationUsd),
      maxRepayUsd: formatUsd(market.maxRepayUsd),
    },
    reserves: [...reserves.values()].map((r) => ({
      address: r.address,
      mint: r.mint,
      symbol: r.symbol,
      oraclePriceUsd: oraclePriceUsd(r),
      priceUpdatedAt: r.priceUpdatedAt,
      lastUpdateSlot: r.lastUpdateSlot,
    })),
    scenarios: runScenarios(modelled, reserves, market, quotes),
    raw: null,
  };
  // Exact decoded inputs allow offline recomputation. The two RPC reads are at different slots.
  return {
    snapshot,
    raw: {
      observedAt,
      slot: source.slot,
      reserveSlot: configSource.slot,
      market,
      reserves: [...reserves.values()],
      loans: loanRows,
      excluded,
    },
  };
}

export function saveSnapshot(
  dir: string,
  result: Awaited<ReturnType<typeof buildSnapshot>>
): RiskSnapshot {
  const { snapshot, raw } = result;
  const rawPath = join("raw", rawFileName(snapshot.observedAt));
  const rawBytes = gzipSync(stringify(raw));
  mkdirSync(join(dir, "raw"), { recursive: true });
  writeFileSync(join(dir, rawPath), rawBytes);
  const saved = {
    ...snapshot,
    raw: {
      path: rawPath,
      sha256: createHash("sha256").update(rawBytes).digest("hex"),
    },
  };
  appendFileSync(
    join(dir, `${snapshot.observedAt.slice(0, 10)}.jsonl`),
    `${JSON.stringify(saved)}\n`
  );
  return saved;
}

export function saveScanError(dir: string, error: RiskError) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(
    join(dir, `${error.observedAt.slice(0, 10)}.jsonl`),
    `${JSON.stringify(error)}\n`
  );
}

async function main() {
  const { values } = parseArgs({
    options: { quotes: { type: "string" }, out: { type: "string" } },
  });
  if (!values.quotes || !values.out)
    throw new Error(
      "Usage: bun scripts/risk/snapshot.ts --quotes <quotes dir> --out <risk dir>"
    );
  const now = new Date();
  let rpcHost = "unavailable";
  try {
    const rpc = createRpcClient({ url: process.env.SOLANA_RPC_URL });
    rpcHost = rpc.host;
    const latest = readLatestQuotes(values.quotes);
    const result = await buildSnapshot({
      rpc,
      now,
      quotes: latest.quotes,
      quoteIssue: latest.issue,
    });
    const saved = saveSnapshot(values.out, result);
    console.log(
      `${saved.observedAt}: slot ${saved.slot}, ${saved.loansModelled}/${saved.loansRead} loans modelled, ${saved.scenarios.length} scenarios -> ${saved.raw!.path}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Risk scan failed";
    saveScanError(values.out, {
      schema: "bidwall.risk-snapshot/v1",
      status: "error",
      observedAt: now.toISOString(),
      session: classifySession(now),
      rpcHost,
      error: message,
    });
    console.error(message);
    process.exitCode = 1;
  }
}

if (import.meta.main) void main();

import { TRACKED_TOKENS, USD_LADDER } from "../quotes/tokens.ts";
import type { ObservationDraft, TokenObservation } from "../quotes/types.ts";
import { SF, USD, type Loan, type Market, type Reserve } from "./kamino.ts";
import {
  atomsValue,
  formatUsd,
  max,
  min,
  valueLoan,
  type ValuedLoan,
} from "./valuation.ts";

export type Scenario = {
  id: string;
  label: string;
  shockPct: number;
  mints: string[];
};
export type RiskRow = {
  symbol: string;
  mint: string;
  decimals: number;
  minBonusBps: number;
  liquidatableDebtUsd: string;
  releasedUsd: string;
  releasedAtoms: string;
  absorbableUsd: string | null;
  absorbableAtoms: string | null;
  absorbableIsLowerBound: boolean;
  shortfallUsd: string | null;
  shortfallIsUpperBound: boolean;
  loans: number;
};
export type ScenarioResult = Scenario & {
  liquidatableLoans: number;
  liquidatableDebtUsd: string;
  estimatedRepayUsd: string;
  releasedUsd: string;
  rows: RiskRow[];
};

export function scenarios(): Scenario[] {
  const shocks = [10, 20, 30];
  return [
    { id: "baseline", label: "Current oracle prices", shockPct: 0, mints: [] },
    ...TRACKED_TOKENS.flatMap((t) =>
      shocks.map((shockPct) => ({
        id: `${t.symbol}-${shockPct}`,
        label: `${t.symbol} −${shockPct}%`,
        shockPct,
        mints: [t.mint],
      }))
    ),
    ...shocks.map((shockPct) => ({
      id: `all-${shockPct}`,
      label: `All xStocks −${shockPct}%`,
      shockPct,
      mints: TRACKED_TOKENS.map((t) => t.mint),
    })),
  ];
}

export type Depth = { atoms: bigint | null; isLowerBound: boolean };

/** Never interpolate across an RPC/quote error or infer a capacity from a missing lot. */
export function absorbableDepth(
  token: TokenObservation | undefined,
  bonusBps: number
): Depth {
  if (!token || token.status !== "ok")
    return { atoms: null, isLowerBound: false };
  let previous: { atoms: bigint; deviation: number } | undefined;
  for (const usd of USD_LADDER) {
    const quote = token.quotes.find((q) => q.lot === `usd-${usd}`);
    if (!quote || quote.status === "error")
      return { atoms: previous?.atoms ?? null, isLowerBound: !!previous };
    if (quote.status === "no-route")
      return { atoms: previous?.atoms ?? 0n, isLowerBound: true };
    if (
      quote.deviationBps === undefined ||
      !Number.isSafeInteger(quote.deviationBps) ||
      !/^\d+$/.test(quote.inAmountRaw)
    )
      return { atoms: null, isLowerBound: false };
    const atoms = BigInt(quote.inAmountRaw);
    if (atoms <= 0n || (previous && atoms <= previous.atoms))
      return { atoms: null, isLowerBound: false };
    if (quote.deviationBps < -bonusBps) {
      // We did not quote below $10k. Zero is a conservative bound, not proof of zero depth.
      if (!previous) return { atoms: 0n, isLowerBound: true };
      const numerator = BigInt(previous.deviation + bonusBps);
      const denominator = BigInt(previous.deviation - quote.deviationBps);
      return {
        atoms:
          previous.atoms + ((atoms - previous.atoms) * numerator) / denominator,
        isLowerBound: false,
      };
    }
    previous = { atoms, deviation: quote.deviationBps };
  }
  return { atoms: previous?.atoms ?? null, isLowerBound: !!previous };
}

/** A single debt leg, prioritising highest borrow factor, then the largest value. */
export function firstLiquidation(valued: ValuedLoan, market: Market) {
  const debt = [...valued.debts].sort((a, b) => {
    const factor = b.reserve.borrowFactorPct - a.reserve.borrowFactorPct;
    const difference = factor === 0n ? b.valueUsd - a.valueUsd : factor;
    return difference > 0n ? 1 : difference < 0n ? -1 : 0;
  })[0];
  if (!debt) throw new Error("No debt leg to liquidate");
  const close =
    valued.adjustedDebtUsd * 100n >
    valued.depositUsd * BigInt(market.insolvencyLtvPct)
      ? 100
      : market.closeFactorPct;
  const repayUsd =
    debt.valueUsd < market.minFullLiquidationUsd
      ? debt.valueUsd
      : min(
          min((valued.debtUsd * BigInt(close)) / 100n, market.maxRepayUsd),
          debt.valueUsd
        );
  // This is a proportional allocation estimate, not Kamino's collateral-priority execution.
  const released = valued.deposits.map((deposit) => {
    const bonusBps = Math.max(
      deposit.reserve.minBonusBps,
      debt.reserve.minBonusBps
    );
    const share =
      valued.depositUsd > 0n
        ? (repayUsd * deposit.valueUsd) / valued.depositUsd
        : 0n;
    const targetUsd = min(
      deposit.valueUsd,
      (share * BigInt(10_000 + bonusBps)) / 10_000n
    );
    // Preserve the token quantity; round down and cap at the deposit.
    const atoms =
      deposit.valueUsd > 0n
        ? min(deposit.atoms, (deposit.atoms * targetUsd) / deposit.valueUsd)
        : 0n;
    return { reserve: deposit.reserve, atoms };
  });
  return { repayUsd, released };
}

export function runScenarios(
  loans: readonly Loan[],
  reserves: ReadonlyMap<string, Reserve>,
  market: Market,
  quotes: ObservationDraft | null
): ScenarioResult[] {
  return scenarios().map((scenario) => {
    const prices = new Map(
      [...reserves.values()].map((r) => [
        r.mint,
        scenario.mints.includes(r.mint)
          ? (r.priceSf * BigInt(100 - scenario.shockPct)) / 100n
          : r.priceSf,
      ])
    );
    const byMint = new Map<
      string,
      { reserve: Reserve; debt: bigint; releasedAtoms: bigint; loans: number }
    >();
    for (const reserve of reserves.values()) {
      if (!byMint.has(reserve.mint))
        byMint.set(reserve.mint, {
          reserve,
          debt: 0n,
          releasedAtoms: 0n,
          loans: 0,
        });
    }
    let liquidatableLoans = 0;
    let liquidatableDebtUsd = 0n;
    let estimatedRepayUsd = 0n;
    for (const loan of loans) {
      const valued = valueLoan(loan, reserves, prices);
      if (
        !valued.liquidatable ||
        market.emergencyMode ||
        market.priceLiquidationDisabled
      )
        continue;
      liquidatableLoans++;
      liquidatableDebtUsd += valued.debtUsd;
      const liquidation = firstLiquidation(valued, market);
      estimatedRepayUsd += liquidation.repayUsd;
      const heldMints = new Set(valued.deposits.map((d) => d.reserve.mint));
      for (const mint of heldMints) {
        const row = byMint.get(mint)!;
        row.loans++;
        row.debt += valued.debtUsd;
      }
      for (const released of liquidation.released)
        byMint.get(released.reserve.mint)!.releasedAtoms += released.atoms;
    }
    let totalReleasedUsd = 0n;
    const rows = [...byMint.values()]
      .map(({ reserve, debt, releasedAtoms, loans }): RiskRow => {
        const token = quotes?.tokens.find(
          (t) => t.mint === reserve.mint && t.decimals === reserve.decimals
        );
        const depth = absorbableDepth(token, reserve.minBonusBps);
        const price = prices.get(reserve.mint)!;
        const releasedUsd = atomsValue(releasedAtoms, reserve, price);
        totalReleasedUsd += releasedUsd;
        const absorbableUsd =
          depth.atoms === null ? null : atomsValue(depth.atoms, reserve, price);
        return {
          symbol: reserve.symbol,
          mint: reserve.mint,
          decimals: reserve.decimals,
          minBonusBps: reserve.minBonusBps,
          liquidatableDebtUsd: formatUsd(debt),
          releasedAtoms: releasedAtoms.toString(),
          releasedUsd: formatUsd(releasedUsd),
          absorbableAtoms: depth.atoms?.toString() ?? null,
          absorbableUsd:
            absorbableUsd === null ? null : formatUsd(absorbableUsd),
          absorbableIsLowerBound: depth.isLowerBound,
          shortfallUsd:
            absorbableUsd === null
              ? null
              : formatUsd(max(0n, releasedUsd - absorbableUsd)),
          shortfallIsUpperBound: depth.isLowerBound,
          loans,
        };
      })
      .sort((a, b) => {
        const aValue = BigInt(a.releasedUsd.replace(".", ""));
        const bValue = BigInt(b.releasedUsd.replace(".", ""));
        return aValue === bValue
          ? a.symbol.localeCompare(b.symbol)
          : aValue > bValue
            ? -1
            : 1;
      });
    return {
      ...scenario,
      liquidatableLoans,
      liquidatableDebtUsd: formatUsd(liquidatableDebtUsd),
      estimatedRepayUsd: formatUsd(estimatedRepayUsd),
      releasedUsd: formatUsd(totalReleasedUsd),
      rows,
    };
  });
}

export function oraclePriceUsd(reserve: Reserve): string {
  return formatUsd((reserve.priceSf * USD) / SF);
}

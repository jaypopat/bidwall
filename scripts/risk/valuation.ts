import { SF, USD, type Loan, type Reserve } from "./kamino.ts";

export const min = (a: bigint, b: bigint) => (a < b ? a : b);
export const max = (a: bigint, b: bigint) => (a > b ? a : b);
export const sum = (values: readonly bigint[]) =>
  values.reduce((a, b) => a + b, 0n);
export const formatUsd = (micro: bigint) =>
  `${micro / USD}.${(micro % USD).toString().padStart(6, "0")}`;

export function atomsValue(
  atoms: bigint,
  reserve: Reserve,
  priceSf = reserve.priceSf
): bigint {
  return (atoms * priceSf * USD) / (SF * 10n ** BigInt(reserve.decimals));
}

export type Position = {
  reserve: Reserve;
  atoms: bigint;
  valueUsd: bigint;
};
export type ValuedLoan = {
  loan: Loan;
  deposits: Position[];
  debts: Position[];
  depositUsd: bigint;
  debtUsd: bigint;
  adjustedDebtUsd: bigint;
  thresholdUsd: bigint;
  liquidatable: boolean;
};

export function valueLoan(
  loan: Loan,
  reserves: ReadonlyMap<string, Reserve>,
  prices: ReadonlyMap<string, bigint> = new Map()
): ValuedLoan {
  if (loan.elevationGroup !== 0) throw new Error("elevation-group");
  if (!loan.borrows.length) throw new Error("no-debt");
  if (!loan.deposits.length) throw new Error("no-collateral");
  const resolve = (address: string) => {
    const reserve = reserves.get(address);
    if (!reserve) throw new Error("missing-reserve");
    if (reserve.priceSf <= 0n) throw new Error("unusable-oracle-price");
    return reserve;
  };
  const deposits = loan.deposits.map((d): Position => {
    const reserve = resolve(d.reserve);
    const supplySf =
      reserve.availableAtoms * SF + reserve.borrowedSf - reserve.feesSf;
    if (reserve.collateralSupply <= 0n || supplySf <= 0n)
      throw new Error("unusable-exchange-rate");
    const underlyingSf = (d.ctokens * supplySf) / reserve.collateralSupply;
    const price = prices.get(reserve.mint) ?? reserve.priceSf;
    return {
      reserve,
      atoms: underlyingSf / SF,
      valueUsd:
        (underlyingSf * price * USD) /
        (SF * SF * 10n ** BigInt(reserve.decimals)),
    };
  });
  const debts = loan.borrows.map((b): Position => {
    const reserve = resolve(b.reserve);
    const price = prices.get(reserve.mint) ?? reserve.priceSf;
    return {
      reserve,
      atoms: b.borrowedSf / SF,
      valueUsd:
        (b.borrowedSf * price * USD) /
        (SF * SF * 10n ** BigInt(reserve.decimals)),
    };
  });
  const depositUsd = sum(deposits.map((d) => d.valueUsd));
  const debtUsd = sum(debts.map((d) => d.valueUsd));
  if (debtUsd <= 0n) throw new Error("debt-below-resolution");
  const adjustedDebtUsd = sum(
    debts.map((d) => (d.valueUsd * d.reserve.borrowFactorPct) / 100n)
  );
  const thresholdUsd = sum(
    deposits.map(
      (d) => (d.valueUsd * BigInt(d.reserve.liquidationThresholdPct)) / 100n
    )
  );
  return {
    loan,
    deposits,
    debts,
    depositUsd,
    debtUsd,
    adjustedDebtUsd,
    thresholdUsd,
    liquidatable: adjustedDebtUsd >= thresholdUsd,
  };
}

import type { DemoTerms } from "../bidwall/demo-terms";
import type { DemoReceipt } from "../demo/types";

/** Illustration only: holds the replay's collateral/debt ratio constant while
 * applying an observed sale haircut. It does not simulate a large liquidation.
 */
export function liquidationComparison(
  demo: DemoTerms,
  receipt: DemoReceipt,
  collateralValueUsd: number,
  saleLossPct: number
) {
  const settlement = receipt.settlement;
  if (
    receipt.status !== "passed" ||
    receipt.pair.id !== demo.pair.id ||
    !settlement ||
    !Number.isFinite(collateralValueUsd) ||
    collateralValueUsd <= 0 ||
    !Number.isFinite(saleLossPct)
  )
    return null;

  const [mantissa, shift] = demo.stressedPrice;
  const oraclePriceUsd = Number(mantissa) / 10 ** Number(shift);
  const bidPriceUsd = Number(demo.price) / 1e6;
  const collateral =
    Number(settlement.deliveredCollateralAtoms) / 10 ** demo.pair.decimals;
  const debt = Number(settlement.repaidUsdcAtoms) / 1e6;
  if (debt <= 0 || collateral <= 0 || oraclePriceUsd <= 0) return null;

  const collateralToDebt = (collateral * oraclePriceUsd) / debt;
  return {
    oraclePriceUsd,
    bidPriceUsd,
    collateralUpliftPct: (collateralToDebt - 1) * 100,
    // A haircut applies to all seized collateral, including its uplift.
    dexMarginPct: (collateralToDebt * (1 - saleLossPct / 100) - 1) * 100,
    bidSurplusPct:
      (collateralToDebt * (bidPriceUsd / oraclePriceUsd) - 1) * 100,
    requiredEscrowUsdc: collateralValueUsd * (bidPriceUsd / oraclePriceUsd),
  };
}

/** Local demo scenario per supported pair. The runner, console server and page all
 * read these, so a receipt can only validate against the terms it was run with.
 */
import { KAMINO_PAIRS, type KaminoPair } from "./kamino";
import { consideration } from "./units";

export type DemoTerms = {
  pair: KaminoPair;
  /** Console label for the lending market. */
  market: string;
  /** Offline replay fixture and its manifest in anchor/programs/bidwall/fixtures. */
  fixture: string;
  manifest: string;
  /** USDC atoms per `pair.scale` raw collateral atoms. */
  price: bigint;
  quantity: bigint;
  /** Repayment bound the keeper passes to Kamino for the first fill. */
  maxRepay: bigint;
  /** Scope spot and TWAP entries for the collateral in the shared feed. */
  scopeIndices: readonly [number, number];
  /** Oracle prices as [mantissa, shift]: value = mantissa × 10^(exp − shift). */
  healthyPrice: readonly [bigint, bigint];
  stressedPrice: readonly [bigint, bigint];
  /** Captured loan's LTV before stress and Kamino's liquidation LTV, in percent. */
  loanLtv?: { healthy: number; liquidation: number };
  /** Human-readable prices for the console. */
  healthyLabel: string;
  stressedLabel: string;
};

export const DEMO_TERMS: Record<KaminoPair["id"], DemoTerms> = {
  nvdax: {
    pair: KAMINO_PAIRS.nvdax,
    market: "Kamino v2 · xStocks market",
    fixture: "kamino.json.gz",
    manifest: "manifest.json",
    price: 150_000_000n, // 150 USDC per NVDAx
    quantity: 1_000_000_000n, // 10 NVDAx
    maxRepay: 1_000_000_000n,
    scopeIndices: [332, 269],
    healthyPrice: [225n, 0n],
    stressedPrice: [150n, 0n],
    healthyLabel: "225",
    stressedLabel: "150",
  },
  onyc: {
    pair: KAMINO_PAIRS.onyc,
    market: "Kamino v2 · OnRe market",
    fixture: "kamino-onyc.json.gz",
    manifest: "manifest-onyc.json",
    // 0.94 USDC per ONyc: just under the stressed 0.95, so the provider buys below
    // the marked-down value and payment still covers this liquidation's debt.
    price: 940_000n,
    quantity: 5_000_000_000_000n, // 5,000 ONyc
    maxRepay: 1_000_000_000n,
    scopeIndices: [350, 478],
    healthyPrice: [115n, 2n],
    // Kamino's lowest accepted ONyc price (reserve heuristic lower bound).
    stressedPrice: [95n, 2n],
    loanLtv: { healthy: 65.4, liquidation: 75 },
    healthyLabel: "1.15",
    stressedLabel: "0.95",
  },
};

export function demoTerms(id: string): DemoTerms {
  const terms = DEMO_TERMS[id as KaminoPair["id"]];
  if (!terms) throw new Error(`Unsupported demo pair: ${id}`);
  return terms;
}

/** USDC atoms escrowed for the scenario's bid. */
export function demoBudget(terms: DemoTerms): bigint {
  return consideration(terms.quantity, terms.price, terms.pair.scale);
}

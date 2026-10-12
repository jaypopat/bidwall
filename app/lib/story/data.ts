/** Research figures quoted by the story page. Source: Kamino market API and
 * Jupiter sell quotes, 12 October 2026 (docs/research/2026-10-12-rwa-collateral-wedge.md).
 */
export const OBSERVED_AT = "12 Oct 2026";

/** Stablecoin debt borrowed on Kamino against RWA and yield tokens. */
export const RWA_DEBT = "$446M";
export const STOCK_DEBT = "$5.2M";

export type DepthSeries = {
  id: string;
  label: string;
  collateral?: string;
  /** Price impact in percent at $100k, $1M and $5M; null = no route. */
  impact: readonly [number | null, number | null, number | null];
  tone: "focus" | "muted" | "funded";
};

export const SALE_SIZES = ["$100k", "$1M", "$5M"] as const;

export const DEPTH: readonly DepthSeries[] = [
  {
    id: "onyc",
    label: "ONyc",
    collateral: "$155.7M",
    impact: [-0.31, -0.52, -43],
    tone: "focus",
  },
  {
    id: "auto",
    label: "AUTO",
    collateral: "$78.1M",
    impact: [-0.03, -0.1, -98],
    tone: "muted",
  },
  {
    id: "usde",
    label: "USDe",
    collateral: "$151.2M",
    impact: [0.07, 0.01, -80],
    tone: "muted",
  },
  {
    id: "funded",
    label: "Issuer-funded",
    impact: [-0.02, -0.04, -0.18],
    tone: "funded",
  },
];

export const NO_ROUTE = { label: "FWDI", collateral: "$22.7M" };

export const ONRE_ENGINE = {
  date: "24 Sep 2026",
  share: "~15%",
  url: "https://www.onre.finance/blog/introducing-onres-liquidity-engine-powered-by-titan",
};

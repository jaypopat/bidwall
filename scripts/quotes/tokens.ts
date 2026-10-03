/** Tokens the observer quotes, identified by verified mint (never by symbol). */
export type TrackedToken = { symbol: string; mint: string; decimals: number };

export const USDC = {
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  decimals: 6,
} as const;

/** xStocks (Token-2022, 8 decimals), from the evidence appendix. */
export const TRACKED_TOKENS: readonly TrackedToken[] = [
  {
    symbol: "NVDAx",
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    decimals: 8,
  },
  {
    symbol: "TSLAx",
    mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    decimals: 8,
  },
  {
    symbol: "AAPLx",
    mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    decimals: 8,
  },
  {
    symbol: "METAx",
    mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    decimals: 8,
  },
  {
    symbol: "SPYx",
    mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    decimals: 8,
  },
];

/** Whole-dollar lot sizes quoted for every token. */
export const USD_LADDER: readonly bigint[] = [
  10_000n,
  50_000n,
  100_000n,
  250_000n,
  500_000n,
  1_000_000n,
];

/** The exact NVDAx quantity the Bidwall demo settles, in raw atoms. */
export const DEMO_LOT = { symbol: "NVDAx", atoms: 396_422_366n } as const;

/** Bounded slippage: Jupiter's minimum output is 0.5% below the quote. */
export const SLIPPAGE_BPS = 50;

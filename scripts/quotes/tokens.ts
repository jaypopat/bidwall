/** Tokens the observer quotes, identified by verified mint (never by symbol). */
export type TrackedToken = { symbol: string; mint: string; decimals: number };

export const USDC = {
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  decimals: 6,
} as const;

/**
 * Every xStock held as collateral in Kamino's public xStocks market
 * (5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua), largest supply first as of
 * 3 October 2026. Mints match both Kamino's reserves and Jupiter's token API;
 * all are Token-2022 with 8 decimals.
 */
export const TRACKED_TOKENS: readonly TrackedToken[] = [
  {
    symbol: "SPYx",
    mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    decimals: 8,
  },
  {
    symbol: "MSTRx",
    mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",
    decimals: 8,
  },
  {
    symbol: "GOOGLx",
    mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    decimals: 8,
  },
  {
    symbol: "QQQx",
    mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    decimals: 8,
  },
  {
    symbol: "TSLAx",
    mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    decimals: 8,
  },
  {
    symbol: "NVDAx",
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    decimals: 8,
  },
  {
    symbol: "CRCLx",
    mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    decimals: 8,
  },
  {
    symbol: "HOODx",
    mint: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg",
    decimals: 8,
  },
  {
    symbol: "AAPLx",
    mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
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

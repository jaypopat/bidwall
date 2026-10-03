export type DemoStep = {
  label: string;
  status: "confirmed" | "rejected-in-simulation";
  signature?: string;
  slot?: number;
  unitsConsumed?: number;
  reason?: string;
};

export type DemoStage = {
  id: "funded" | "locked" | "healthy" | "stressed" | "settled" | "withdrawn";
  mode: "confirmed" | "rejected-in-simulation" | "local-override";
};

export type DemoReceipt = {
  status: "running" | "passed" | "failed";
  startedAt: string;
  upstreamSlot: number;
  fixtureSha256: string;
  bidwallSha256?: string;
  steps: DemoStep[];
  stages: DemoStage[];
  commitment?: {
    start: string;
    expiry: string;
    scenarioNow: string;
    price: string;
    quantity: string;
    fundedUsdcAtoms: string;
  };
  depletion?: {
    bid: string;
    fundedUsdcAtoms: string;
    deliveredNvdaAtoms: string;
    remainingFunds: string;
    remainingQuantity: string;
    uncoveredRepayUsdcAtoms: string;
    status: "exhausted-and-rejected-in-simulation";
  };
  comparison?: DemoQuote;
  settlement?: {
    bid: string;
    obligation: string;
    paidUsdcAtoms: string;
    repaidUsdcAtoms: string;
    borrowerUsdcAtoms: string;
    deliveredNvdaAtoms: string;
    remainingQuantity: string;
    remainingFunds: string;
  };
  capacityFailure?: {
    requestedRepay: string;
    availableFunds: string;
    status: string;
  };
  error?: string;
};

export type DemoQuote = {
  status: "ok" | "no-route" | "error";
  observedAt: string;
  inputMint: string;
  outputMint: string;
  inputDecimals: 8;
  outputDecimals: 6;
  inAmountRaw: string;
  slippageBps: number;
  outAmountRaw?: string;
  minOutAmountRaw?: string;
  contextSlot?: number;
  routeLabels?: string[];
  priceImpactPct?: string;
  referencePriceUsd?: string;
  rawSha256: string;
  rawPath: string;
};

export type DemoResponse = {
  enabled: boolean;
  running: boolean;
  output: string[];
  receipt: DemoReceipt | null;
  error?: string;
};

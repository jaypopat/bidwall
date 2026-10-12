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

export type DemoPair = {
  id: "nvdax" | "onyc";
  symbol: string;
  decimals: number;
};

export type DemoReceipt = {
  status: "running" | "passed" | "failed";
  pair: DemoPair;
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
    deliveredCollateralAtoms: string;
    remainingFunds: string;
    remainingQuantity: string;
    uncoveredRepayUsdcAtoms: string;
    status: "exhausted-and-rejected-in-simulation";
  };
  settlement?: {
    bid: string;
    obligation: string;
    paidUsdcAtoms: string;
    repaidUsdcAtoms: string;
    borrowerUsdcAtoms: string;
    deliveredCollateralAtoms: string;
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

export type DemoResponse = {
  enabled: boolean;
  running: boolean;
  output: string[];
  receipt: DemoReceipt | null;
  error?: string;
};

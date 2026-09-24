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

export type DemoResponse = {
  enabled: boolean;
  running: boolean;
  output: string[];
  receipt: DemoReceipt | null;
  error?: string;
};

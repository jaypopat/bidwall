/** Interpret named program errors, never a bare custom number shared by many programs. */
export function explainSimulationFailure(logs: readonly string[]): {
  reason: string;
  nextStep: string;
} {
  const error = logs.findLast((line) => line.includes("Error Code:")) ?? "";
  const name = error.match(/Error Code: (\w+)/)?.[1];
  switch (name) {
    case "ObligationHealthy":
      return {
        reason: "The lender says this loan is healthy.",
        nextStep: "Do not submit a liquidation.",
      };
    case "PriceTooOld":
    case "ReserveStale":
    case "ObligationStale":
      return {
        reason: "The lender cannot use stale price or loan state.",
        nextStep:
          "Fetch fresh state and prepare the native refresh instructions again.",
      };
    case "Replay":
      return {
        reason: "The bid capacity or loan quote has changed.",
        nextStep:
          "Read the current bid and loan, then simulate a new bounded transaction.",
      };
    case "Capacity":
      return {
        reason:
          "The bid cannot cover this repayment or collateral quantity at its fixed price.",
        nextStep:
          "Expose the uncovered amount; choose another bid or prepare a smaller eligible liquidation.",
      };
    case "Window":
      return {
        reason: "This action is outside its permitted commitment window.",
        nextStep: "Check the start and expiry times.",
      };
    case "State":
      return {
        reason: "The bid is not in the required lifecycle state.",
        nextStep: "Read its current state before choosing an action.",
      };
    case "LiquidationRewardTooSmall":
      return {
        reason: "Collateral delivery would miss the requested minimum.",
        nextStep: "Inspect the new quote; do not silently loosen the bound.",
      };
    default:
      return {
        reason: "The transaction failed validation or execution.",
        nextStep:
          "Inspect the program logs. Do not submit or automatically retry this transaction.",
      };
  }
}

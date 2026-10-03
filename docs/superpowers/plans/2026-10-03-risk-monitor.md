# Risk monitor implementation

3 October 2026 · completed in the working tree

Build the [reviewed design](../specs/2026-10-03-risk-monitor-design.md) around the
existing quote observer and operator console. No new runtime dependencies,
indexer, signing path, or public Bidwall deployment.

## Review corrections

- A scan needs two RPC methods, not three. Keep both context slots and request
  reserves at least as recent as the loan read.
- Decode the insolvency threshold: close factor rises to 100% above it. Cap a
  first repayment at one selected debt leg, prioritising highest borrow factor.
- Compare token quantities before valuing both sides at the shocked oracle price.
  Keep quote reference prices distinct from Kamino oracle prices.
- Treat missing quotes as unknown; do not interpolate across quote failures.
  Mark ladder limits as lower bounds and resulting shortfalls as upper bounds.
- Keep decoded reserve/market inputs in raw evidence for offline recomputation.
  Measure storage size instead of relying on the original 80 KB estimate.

## Delivery sequence

1. Implement strict account decoders, bounded RPC reads, integer valuation, and
   baseline, individual-asset, and all-asset scenarios in five `scripts/risk` files.
2. Capture unchanged public mainnet fixtures; test hand-computed valuation,
   liquidation caps/priority, quote crossings/gaps, RPC failures and raw hashes.
3. Add the CLI and JSONL/gzip evidence writer; extend hourly CI after the quote
   observation, preserving both scans and outages on `evidence/quotes`.
4. Add `GET /api/risk` and a manual Market risk scan, scenario selector and table
   next to the local demo commitment. Show quote age, exclusion counts and limits.
5. Compare seven fixture loans and 12 reserves with klend-sdk 12.0.0; run live
   mainnet scans, browser checks, and `npm run ci`. Desktop scanning and scenario
   switching passed; mobile CSS is implemented, but the shared preview disconnected
   before mobile browser verification.

The monitor uses stored oracle prices and debt at each loan’s last refresh.
Proportional collateral allocation and the fixed quote curve are explicit model
assumptions. It must report a zero or unknown gap as plainly as a positive gap.

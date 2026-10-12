# Bidwall component status

As of 12 October 2026, after adding the OnRe ONyc pair. This is the current component map;
older milestone documents explain the implementation history.

| Component          | Current state                                                                                                        | What remains                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Bidwall contracts  | Funded lifecycle and external settlement implemented; 45 workspace tests pass                                        | Independent review and deployment-specific operational decisions before real funds   |
| Lender harness     | Separate deployed test program plus malicious-program fixture                                                        | Retained for controlled adversarial tests                                            |
| Kamino adapter     | Real v2 CPI verified on a mainnet fork and captured-binary replay for NVDAx/USDC and OnRe ONyc/USDC                  | Fixed pair table; permissioned RWA tokens and other reserves not yet supported       |
| Fresh-fork tooling | Mainnet reads, controlled local oracle stress, verified settlement, explicit fixture capture                         | Research SDK advisories remain; live state may require reselection                   |
| Offline demo       | Full lifecycle plus a separately funded exact-capacity Kamino replay verifies exhaustion and rejects another attempt | Individually controlled steps and broader operator experience                        |
| Shared client      | Generated Anchor bindings, exact units, PDA/account preparation, bounded settlement and error explanations; 6 tests  | Application state fetching, wallet wiring and simulation/confirmation UI             |
| Keeper             | Manual transaction preparation exists                                                                                | No continuous watcher, automatic opportunity discovery or production signing service |
| Frontend           | Story console with recorded fallback, sale-size comparison, live depth quotes, money flow and execution ledger       | Wallet-driven bid entry, live account reads and interactive settlement review        |
| Quote observer     | Hourly Jupiter quotes for nine xStocks and the demo lot, labelled by market session, on the `evidence/quotes` branch | More weekend and trading-hours observations to cite                                  |
| Risk monitor       | Read-only mainnet loan scans, 31 stress scenarios, quote-depth comparison, hourly evidence and console view          | Longer evidence series and an operator assessment of the measured gaps               |
| Deployment         | Local runtimes only                                                                                                  | No mainnet or public Bidwall deployment claimed                                      |
| Economics / demand | Still hypotheses                                                                                                     | Named operator use case, provider terms, reservation and keeper compensation         |

Use the risk evidence to assess which asset and conditions warrant committed
liquidation capacity before broadening the execution demo. The console still
operates the fixed local scenario; choosing bid terms and signing individual
steps against a persistent local runtime remain separate work.

## Start here

- **What are we building?** [Product brief](RWA-LIQUIDATION-DEPTH.md).
- **Why this design?** [Critical review](RWA-LIQUIDATION-DEPTH-REVIEW.md).
- **How does the lender settlement work?** [Kamino integration](KAMINO-INTEGRATION.md).
- **Can I run and inspect it?** [Operator demo](OPERATOR-DEMO.md) or [web console](FRONTEND.md): `npm run dev:demo`.
- **Where would committed capacity help?** [Risk monitor](RISK-MONITOR.md): scan loans and compare observed exit depth.
- **What remains and what must we decide?** [Next milestone](NEXT-MILESTONE.md).

Current risk-monitor checks: 41 quote tests, 23 risk tests, web build/lint/format,
strict script typechecking, live mainnet scans, and SDK comparison of seven loans
and 12 reserves. The current demo suite has 11 tests for live depth validation and the illustrative
comparison math and integer-based amount display. Desktop/mobile layouts, the hosted recorded fallback, a live $5M
Jupiter quote and the $0.94 ONyc browser run were verified. The comparison labels
scaled funding as hypothetical; the actual replay repays $1,000 of debt.

The hourly quote-observer workflow also scans market risk from the default branch,
using the repository's configured RPC secret. Current marketwide stress evidence has not shown a positive xStock shortfall
under the documented first-liquidation/fixed-quote-curve model. Commercial usefulness
remains to be established through a longer evidence series and provider/operator terms.

Current execution checks: 45 Rust workspace tests, 6 client/manifest tests and
successful repeated offline demo. The fork SDK advisories and production limitations
are documented in the integration notes; passing tests do not remove those limitations.

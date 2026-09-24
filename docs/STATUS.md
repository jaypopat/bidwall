# Bidwall component status

As of 24 September 2026, after the first frontend pass. This is the current component map;
older milestone documents explain the implementation history.

| Component          | Current state                                                                                                        | What remains                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Bidwall contracts  | Funded lifecycle and external settlement implemented; 46 workspace tests pass                                        | Independent review and deployment-specific operational decisions before real funds   |
| Lender harness     | Separate deployed test program plus malicious-program fixture                                                        | Retained for controlled adversarial tests                                            |
| Kamino adapter     | Real v2 CPI verified on a mainnet fork and captured-binary replay                                                    | Support remains limited to the documented public NVDAx/USDC route                    |
| Fresh-fork tooling | Mainnet reads, controlled local oracle stress, verified settlement, explicit fixture capture                         | Research SDK advisories remain; live state may require reselection                   |
| Offline demo       | Terminal command or loopback browser action runs a fresh full scenario and exports a verified receipt                | Individually controlled steps and broader operator experience                        |
| Shared client      | Generated Anchor bindings, exact units, PDA/account preparation, bounded settlement and error explanations; 6 tests  | Application state fetching, wallet wiring and simulation/confirmation UI             |
| Keeper             | Manual transaction preparation exists                                                                                | No continuous watcher, automatic opportunity discovery or production signing service |
| Frontend           | Bidwall console follows six live scenario stages, then shows commitment, capacity, money flow and transaction ledger | Wallet-driven bid entry, live account reads and interactive settlement review        |
| Quote observer     | Not implemented                                                                                                      | Reproducible same-quantity observations with honest time/environment labels          |
| Deployment         | Local runtimes only                                                                                                  | No mainnet or public Bidwall deployment claimed                                      |
| Economics / demand | Still hypotheses                                                                                                     | Named operator use case, provider terms, reservation and keeper compensation         |

The practical next implementation is a wallet-driven functional console against a
persistent local runtime. The current console operates the fixed scripted scenario
and inspects its receipt; it does not yet let a user choose bid terms or sign steps.

## Start here

- **What are we building?** [Product brief](RWA-LIQUIDATION-DEPTH.md).
- **Why this design?** [Critical review](RWA-LIQUIDATION-DEPTH-REVIEW.md).
- **How does the lender settlement work?** [Kamino integration](KAMINO-INTEGRATION.md).
- **Can I run and inspect it?** [Operator demo](OPERATOR-DEMO.md) or [web console](FRONTEND.md): `npm run dev:demo`.
- **What remains and what must we decide?** [Next milestone](NEXT-MILESTONE.md).

Latest checks: 46 Rust workspace tests, 6 client/manifest tests, successful repeated
offline demo, and web build/lint/format checks. The fork SDK advisories and production limitations are documented
in the integration notes; passing tests do not remove those limitations.

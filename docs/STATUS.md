# Bidwall component status

As of 24 September 2026, after milestone 4. This is the current component map;
older milestone documents explain the implementation history.

| Component          | Current state                                                                                                       | What remains                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Bidwall contracts  | Funded lifecycle and external settlement implemented; 46 workspace tests pass                                       | Independent review and deployment-specific operational decisions before real funds   |
| Lender harness     | Separate deployed test program plus malicious-program fixture                                                       | Retained for controlled adversarial tests                                            |
| Kamino adapter     | Real v2 CPI verified on a mainnet fork and captured-binary replay                                                   | Support remains limited to the documented public NVDAx/USDC route                    |
| Fresh-fork tooling | Mainnet reads, controlled local oracle stress, verified settlement, explicit fixture capture                        | Research SDK advisories remain; live state may require reselection                   |
| Offline demo       | One command starts a fresh runtime, funds, settles, demonstrates rejection, expires and withdraws; exports receipt  | Interactive console and broader operator experience                                  |
| Shared client      | Generated Anchor bindings, exact units, PDA/account preparation, bounded settlement and error explanations; 6 tests | Application state fetching, wallet wiring and simulation/confirmation UI             |
| Keeper             | Manual transaction preparation exists                                                                               | No continuous watcher, automatic opportunity discovery or production signing service |
| Frontend           | Next.js wallet/SOL-vault starter builds                                                                             | Bidwall commitment, capacity and settlement views are not built yet                  |
| Quote observer     | Not implemented                                                                                                     | Reproducible same-quantity observations with honest time/environment labels          |
| Deployment         | Local runtimes only                                                                                                 | No mainnet or public Bidwall deployment claimed                                      |
| Economics / demand | Still hypotheses                                                                                                    | Named operator use case, provider terms, reservation and keeper compensation         |

The practical next implementation is the functional console, using the shared client.
The contract tests have passed the original prerequisite for starting interface work.

## Start here

- **What are we building?** [Product brief](RWA-LIQUIDATION-DEPTH.md).
- **Why this design?** [Critical review](RWA-LIQUIDATION-DEPTH-REVIEW.md).
- **How does the lender settlement work?** [Kamino integration](KAMINO-INTEGRATION.md).
- **Can I run and inspect it?** [Operator demo](OPERATOR-DEMO.md): `npm run demo:kamino`.
- **What remains and what must we decide?** [Next milestone](NEXT-MILESTONE.md).

Latest checks: 46 Rust workspace tests, 6 client/manifest tests, successful repeated
offline demo, and web build/lint/format checks. Three pre-existing frontend lint
warnings remain. The fork SDK advisories and production limitations are documented
in the integration notes; passing tests do not remove those limitations.

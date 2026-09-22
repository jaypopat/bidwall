# Local program builds

Use `npm run anchor-test`. Install Anchor CLI 1.1.2 with `avm install 1.1.2` first.
Anchor.toml and the Anchor crates use 1.1.2. This CLI uses platform-tools v1.52 and
SBPF v0; no build argument override or `--ignore-keys` is needed. Solana build-sbf
3.1.15 and host Rust 1.96.0 were used. Cargo.lock is tracked.

The local-only key generation script derives public deterministic identities,
checks them against source and Anchor.toml, and writes ignored deployment key files.
These are PUBLIC TEST KEYS: never use these identities for public deployments or
send assets to them. Tests use them only inside LiteSVM. No personal wallet file is
read. A public deployment requires new program identities and separate configuration.

The inherited AppImage variables in this development host break AVM and Rustup
subprocess dispatch; build/test commands strip those variables. A real stack overflow
exposed by platform-tools v1.52 was fixed by boxing the token/mint account wrappers;
it was not suppressed. All 23 pre-adapter workspace tests pass under this toolchain.

`lender_harness` has its own local identity. The `malicious_lender` test fixture
deliberately reuses it so tests can load it in place of the lender.

This supersedes the version mismatch, placeholder ID and `--ignore-keys` notes in
the first milestone's CORE-IMPLEMENTATION.md.

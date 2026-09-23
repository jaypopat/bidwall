# Local program builds

Use `npm run anchor-test`. Install Anchor CLI 1.1.2 with `avm install 1.1.2` first.
Anchor.toml and the Anchor crates use 1.1.2. This CLI uses platform-tools v1.52 and
SBPF v0; no build argument override or `--ignore-keys` is needed. Solana build-sbf
3.1.15 and host Rust 1.96.0 were used. Cargo.lock is tracked.

The local-only key generation script derives public deterministic identities,
checks them against source and Anchor.toml, and writes ignored deployment key files.
These are PUBLIC TEST KEYS: never use these identities for public deployments or
send assets to them. Tests use them only inside LiteSVM or isolated local Surfpool runtimes. No personal wallet file is
read. A public deployment requires new program identities and separate configuration.

The inherited AppImage variables in this development host break AVM and Rustup
subprocess dispatch; build/test commands strip those variables. A real stack overflow
exposed by platform-tools v1.52 was fixed by boxing the token/mint account wrappers;
it was not suppressed. The current 46-test workspace suite passes under this toolchain.

`lender_harness` has its own local identity. The `malicious_lender` test fixture
deliberately reuses it so tests can load it in place of the lender.

This supersedes the version mismatch, placeholder ID and `--ignore-keys` notes in
the first milestone's CORE-IMPLEMENTATION.md.

## Application and client dependencies

Use the declared pnpm 12.5.1 and committed `pnpm-lock.yaml`:
`pnpm install --frozen-lockfile --ignore-scripts`. The older starter `bun.lock`
was removed so the root has one authoritative dependency lock. Running npm install
against this pnpm symlink layout caused an Arborist error; `npm run ...` remains
valid for executing scripts. `pnpm-workspace.yaml` explicitly skips the optional
`unrs-resolver` fallback postinstall; prebuilt platform bindings passed local checks.

`npm run client:build` compiles the shared TypeScript client into ignored `build/`.
`npm run codama:bidwall` regenerates its committed bindings from the built Anchor IDL.
`npm run demo:kamino` uses Surfpool 1.3.0 in offline mode; see [operator demo details](OPERATOR-DEMO.md)
for its explicit local clock and program-loading workarounds.

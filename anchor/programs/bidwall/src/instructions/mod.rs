//! One module per instruction: its handler plus its `#[derive(Accounts)]` struct.
pub mod create_bid;
pub mod create_market;
pub mod kamino;
pub mod provider_bid;
pub mod settle;

// Anchor requires the Accounts structs (and their generated client modules) at crate
// root. Handlers share the name `handler` and are always called by full path.
#[allow(ambiguous_glob_reexports)]
pub use {create_bid::*, create_market::*, kamino::*, provider_bid::*, settle::*};

//! One module per instruction: its handler plus its `#[derive(Accounts)]` struct.
pub mod create_market;
pub mod liquidate;
pub mod open_position;
pub mod set_mark;

// Anchor requires the Accounts structs (and their generated client modules) at crate
// root. Handlers share the name `handler` and are always called by full path.
#[allow(ambiguous_glob_reexports)]
pub use {create_market::*, liquidate::*, open_position::*, set_mark::*};

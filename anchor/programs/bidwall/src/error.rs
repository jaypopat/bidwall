use anchor_lang::prelude::*;

// Variant order fixes the on-chain codes (6000 + index); append only.
#[error_code]
pub enum ErrorCode {
    #[msg("Invalid bid or token terms")]
    Terms,
    #[msg("Invalid lifecycle state")]
    State,
    #[msg("Outside permitted time window")]
    Window,
    #[msg("Insufficient bid capacity or proceeds to repay debt")]
    Capacity,
    #[msg("Position settled or stale capacity expectation")]
    Replay,
    #[msg("Position is not liquidatable under lender rules")]
    Healthy,
    #[msg("Integer overflow")]
    Arithmetic,
    #[msg("Lender cash flow did not match the verified quote")]
    LenderMismatch,
}

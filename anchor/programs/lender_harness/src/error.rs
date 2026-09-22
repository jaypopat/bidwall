use anchor_lang::prelude::*;

#[error_code]
pub enum LenderError {
    #[msg("Invalid market or position terms")]
    Terms,
    #[msg("Position already liquidated")]
    Replay,
    #[msg("Position healthy at lender threshold")]
    Healthy,
    #[msg("Liquidation outside slippage bounds")]
    Slippage,
}

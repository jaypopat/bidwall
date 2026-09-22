//! Independently deployed test lender. Its account shapes loosely follow Kamino's
//! liquidation interface (market authority PDA, repay/withdraw reserves with supply
//! vaults, a signing liquidator and slippage bounds). It is not a Kamino emulator.
//!
//! Lender rule: a position is liquidatable when debt exceeds 80% of its marked
//! collateral value. Liquidation is a full-lot sale: the liquidator pays at least the
//! debt, the debt is repaid into the repay reserve, any excess goes to the borrower's
//! registered USDC account, and the whole collateral lot goes to the liquidator's
//! destination. Liquidation is permissionless.
use anchor_lang::prelude::*;

mod eligibility;
mod error;
mod instructions;
mod state;
mod transfer;

pub use eligibility::{quote, LIQUIDATION_THRESHOLD_BPS};
pub use error::LenderError;
pub use instructions::*;
pub use state::*;

declare_id!("2JHZer7Zz7BKFTdHcnrvqAtPMf7zugw5rGbXT14cUw1N");

#[program]
pub mod lender_harness {
    use super::*;

    pub fn create_market(ctx: Context<CreateMarket>, mark: u64) -> Result<()> {
        instructions::create_market::handler(ctx, mark)
    }
    pub fn set_mark(ctx: Context<SetMark>, mark: u64) -> Result<()> {
        instructions::set_mark::handler(ctx, mark)
    }
    pub fn open_position(ctx: Context<OpenPosition>, quantity: u64, debt: u64) -> Result<()> {
        instructions::open_position::handler(ctx, quantity, debt)
    }
    pub fn liquidate(ctx: Context<Liquidate>, payment: u64, min_collateral: u64) -> Result<()> {
        instructions::liquidate::handler(ctx, payment, min_collateral)
    }
}

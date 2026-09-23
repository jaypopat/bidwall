//! Bidwall: funded, fixed-price liquidation bids that settle atomically through an
//! external lender's liquidation instruction.
//!
//! Lifecycle: `create_bid` → `fund_bid` → `activate_bid` → `settle`* → `withdraw_bid`.
//! Settlement CPIs into the pinned lender program and verifies its cash flow.
use anchor_lang::prelude::*;

mod error;
mod instructions;
mod math;
mod state;
#[cfg(test)]
mod tests;
mod transfer;

pub use error::ErrorCode;
pub use instructions::*;
pub use math::consideration;
pub use state::*;

declare_id!("HQhMdM6YjEdrHzD6TGeDLrTCF491EiQntRRpA9Hs2g37");

#[program]
pub mod bidwall {
    use super::*;

    pub fn create_kamino_market(ctx: Context<CreateKaminoMarket>, keeper: Pubkey) -> Result<()> {
        instructions::kamino::register(ctx, keeper)
    }
    pub fn settle_kamino<'info>(
        ctx: Context<'info, SettleKamino<'info>>,
        max_repay: u64,
        min_collateral: u64,
        expected_remaining: u64,
        expected_deposited_ctokens: u64,
    ) -> Result<()> {
        instructions::kamino::execute(
            ctx,
            max_repay,
            min_collateral,
            expected_remaining,
            expected_deposited_ctokens,
        )
    }
    pub fn create_market(ctx: Context<CreateMarket>, keeper: Pubkey) -> Result<()> {
        instructions::create_market::handler(ctx, keeper)
    }
    pub fn create_bid(
        ctx: Context<CreateBid>,
        id: u64,
        price: u64,
        quantity: u64,
        start: i64,
        expiry: i64,
    ) -> Result<()> {
        instructions::create_bid::handler(ctx, id, price, quantity, start, expiry)
    }
    pub fn fund_bid(ctx: Context<ProviderBid>) -> Result<()> {
        instructions::provider_bid::fund(ctx)
    }
    pub fn activate_bid(ctx: Context<ProviderBid>) -> Result<()> {
        instructions::provider_bid::activate(ctx)
    }
    pub fn withdraw_bid(ctx: Context<ProviderBid>) -> Result<()> {
        instructions::provider_bid::withdraw(ctx)
    }
    pub fn settle(ctx: Context<Settle>, expected_remaining: u64) -> Result<()> {
        instructions::settle::handler(ctx, expected_remaining)
    }
}

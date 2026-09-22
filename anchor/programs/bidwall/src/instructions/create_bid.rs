use crate::{
    error::ErrorCode,
    math::consideration,
    state::{Bid, BidState, Market},
};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

/// Creates a Draft bid and its dedicated escrow. Terms are immutable afterwards.
pub fn handler(
    ctx: Context<CreateBid>,
    id: u64,
    price: u64,
    quantity: u64,
    start: i64,
    expiry: i64,
) -> Result<()> {
    require!(
        price > 0 && quantity > 0 && start < expiry && expiry > Clock::get()?.unix_timestamp,
        ErrorCode::Terms
    );
    let budget = consideration(quantity, price, ctx.accounts.market.scale)?;
    require!(budget > 0, ErrorCode::Terms);
    ctx.accounts.bid.set_inner(Bid {
        provider: ctx.accounts.provider.key(),
        market: ctx.accounts.market.key(),
        adapter: ctx.accounts.market.lender_program,
        id,
        price,
        quantity,
        remaining_quantity: quantity,
        remaining_funds: budget,
        start,
        expiry,
        state: BidState::Draft,
        bump: ctx.bumps.bid,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateBid<'info> {
    #[account(mut)]
    pub provider: Signer<'info>,
    #[account(has_one = usdc_mint)]
    pub market: Account<'info, Market>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(init, payer = provider, space = 8 + Bid::INIT_SPACE, seeds = [b"bid", provider.key().as_ref(), &id.to_le_bytes()], bump)]
    pub bid: Account<'info, Bid>,
    #[account(init, payer = provider, seeds = [b"escrow", bid.key().as_ref()], bump, token::mint = usdc_mint, token::authority = bid)]
    pub escrow: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

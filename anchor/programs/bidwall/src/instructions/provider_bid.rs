//! Provider-only lifecycle transitions. There is no cancel or reprice.
use crate::{
    error::ErrorCode,
    state::{Bid, BidState, Market},
    transfer::pay,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

/// Draft → Funded: escrows the full maximum consideration in one transfer.
pub fn fund(ctx: Context<ProviderBid>) -> Result<()> {
    let a = &ctx.accounts;
    require!(a.bid.state == BidState::Draft, ErrorCode::State);
    require!(
        Clock::get()?.unix_timestamp < a.bid.expiry,
        ErrorCode::Window
    );
    pay(
        &a.provider_usdc,
        &a.escrow,
        &a.usdc_mint,
        a.provider.to_account_info(),
        a.bid.remaining_funds,
        &[],
    )?;
    ctx.accounts.bid.state = BidState::Funded;
    Ok(())
}

/// Funded → Active. Activation may precede `start`; settlement cannot.
pub fn activate(ctx: Context<ProviderBid>) -> Result<()> {
    let a = &ctx.accounts;
    require!(a.bid.state == BidState::Funded, ErrorCode::State);
    require!(
        Clock::get()?.unix_timestamp < a.bid.expiry,
        ErrorCode::Window
    );
    require!(
        a.escrow.amount >= a.bid.remaining_funds,
        ErrorCode::Capacity
    );
    ctx.accounts.bid.state = BidState::Active;
    Ok(())
}

/// Any state except Withdrawn → Withdrawn, only once `now >= expiry`.
pub fn withdraw(ctx: Context<ProviderBid>) -> Result<()> {
    let a = &ctx.accounts;
    require!(
        Clock::get()?.unix_timestamp >= a.bid.expiry,
        ErrorCode::Window
    );
    require!(a.bid.state != BidState::Withdrawn, ErrorCode::State);
    let (id, bump) = (a.bid.id.to_le_bytes(), [a.bid.bump]);
    pay(
        &a.escrow,
        &a.provider_usdc,
        &a.usdc_mint,
        a.bid.to_account_info(),
        a.escrow.amount,
        &[&a.bid.signer_seeds(&id, &bump)],
    )?;
    ctx.accounts.bid.remaining_funds = 0;
    ctx.accounts.bid.state = BidState::Withdrawn;
    Ok(())
}

#[derive(Accounts)]
pub struct ProviderBid<'info> {
    pub provider: Signer<'info>,
    #[account(has_one = usdc_mint)]
    pub market: Account<'info, Market>,
    #[account(mut, has_one = provider, has_one = market, seeds = [b"bid", provider.key().as_ref(), &bid.id.to_le_bytes()], bump = bid.bump)]
    pub bid: Account<'info, Bid>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [b"escrow", bid.key().as_ref()], bump, token::mint = usdc_mint, token::authority = bid)]
    pub escrow: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = usdc_mint, token::authority = provider)]
    pub provider_usdc: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

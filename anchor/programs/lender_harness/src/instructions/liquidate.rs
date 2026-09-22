use crate::{
    eligibility::quote,
    error::LenderError,
    state::{Market, Position, Reserve},
    transfer::pay,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

/// Full-lot sale. `payment` buys the whole lot and must cover the debt; the surplus goes
/// to the borrower. `min_collateral` bounds what the liquidator accepts.
pub fn handler(ctx: Context<Liquidate>, payment: u64, min_collateral: u64) -> Result<()> {
    let (debt, quantity) = quote(&ctx.accounts.market, &ctx.accounts.position)?;
    require!(
        payment >= debt && quantity >= min_collateral,
        LenderError::Slippage
    );
    pay(
        &ctx.accounts.source_usdc,
        &ctx.accounts.repay_supply,
        &ctx.accounts.usdc_mint,
        ctx.accounts.liquidator.to_account_info(),
        debt,
        &[],
    )?;
    pay(
        &ctx.accounts.source_usdc,
        &ctx.accounts.borrower_usdc,
        &ctx.accounts.usdc_mint,
        ctx.accounts.liquidator.to_account_info(),
        payment - debt,
        &[],
    )?;
    let market = ctx.accounts.market.key();
    let bump = [ctx.accounts.market.authority_bump];
    let seeds: &[&[u8]] = &[b"authority", market.as_ref(), &bump];
    pay(
        &ctx.accounts.collateral_supply,
        &ctx.accounts.destination_collateral,
        &ctx.accounts.collateral_mint,
        ctx.accounts.market_authority.to_account_info(),
        quantity,
        &[seeds],
    )?;
    let position = &mut ctx.accounts.position;
    position.debt = 0;
    position.quantity = 0;
    position.settled = true;
    Ok(())
}

#[derive(Accounts)]
pub struct Liquidate<'info> {
    pub liquidator: Signer<'info>,
    #[account(has_one = usdc_mint, has_one = collateral_mint, has_one = repay_reserve, has_one = collateral_reserve)]
    pub market: Box<Account<'info, Market>>,
    /// CHECK: PDA signer for the collateral supply vault.
    #[account(seeds = [b"authority", market.key().as_ref()], bump = market.authority_bump)]
    pub market_authority: UncheckedAccount<'info>,
    #[account(has_one = market)]
    pub repay_reserve: Box<Account<'info, Reserve>>,
    #[account(has_one = market)]
    pub collateral_reserve: Box<Account<'info, Reserve>>,
    #[account(mut, has_one = market, has_one = borrower_usdc)]
    pub position: Box<Account<'info, Position>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub collateral_mint: Box<Account<'info, Mint>>,
    /// Liquidator-controlled source. The liquidator may be its owner or a delegate.
    #[account(mut, token::mint = usdc_mint)]
    pub source_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = repay_reserve.supply_vault)]
    pub repay_supply: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = collateral_reserve.supply_vault)]
    pub collateral_supply: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = collateral_mint)]
    pub destination_collateral: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = usdc_mint)]
    pub borrower_usdc: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

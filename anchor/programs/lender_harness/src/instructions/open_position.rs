use crate::{
    error::LenderError,
    state::{Market, Position, Reserve},
    transfer::pay,
};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

/// Models an already outstanding loan. Authority seeds debt; collateral is actually deposited.
pub fn handler(ctx: Context<OpenPosition>, quantity: u64, debt: u64) -> Result<()> {
    require!(quantity > 0 && debt > 0, LenderError::Terms);
    pay(
        &ctx.accounts.source,
        &ctx.accounts.collateral_supply,
        &ctx.accounts.collateral_mint,
        ctx.accounts.authority.to_account_info(),
        quantity,
        &[],
    )?;
    ctx.accounts.position.set_inner(Position {
        market: ctx.accounts.market.key(),
        borrower: ctx.accounts.borrower_usdc.owner,
        borrower_usdc: ctx.accounts.borrower_usdc.key(),
        quantity,
        debt,
        settled: false,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(has_one = authority, has_one = collateral_mint, has_one = usdc_mint, has_one = collateral_reserve)]
    pub market: Box<Account<'info, Market>>,
    pub collateral_reserve: Box<Account<'info, Reserve>>,
    #[account(init, payer = authority, space = 8 + Position::INIT_SPACE)]
    pub position: Box<Account<'info, Position>>,
    pub collateral_mint: Box<Account<'info, Mint>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    /// Residual recipient for liquidation surplus; its owner is the borrower.
    #[account(token::mint = usdc_mint)]
    pub borrower_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = collateral_mint, token::authority = authority)]
    pub source: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = collateral_reserve.supply_vault)]
    pub collateral_supply: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

use crate::{
    error::LenderError,
    state::{Market, Reserve},
};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

/// Creates a market, its two reserves and their supply vaults.
pub fn handler(ctx: Context<CreateMarket>, mark: u64) -> Result<()> {
    require!(
        mark > 0 && ctx.accounts.collateral_mint.decimals <= 9,
        LenderError::Terms
    );
    require!(ctx.accounts.usdc_mint.decimals == 6, LenderError::Terms);
    require_keys_neq!(
        ctx.accounts.collateral_mint.key(),
        ctx.accounts.usdc_mint.key(),
        LenderError::Terms
    );
    let market = ctx.accounts.market.key();
    ctx.accounts.market.set_inner(Market {
        authority: ctx.accounts.authority.key(),
        collateral_mint: ctx.accounts.collateral_mint.key(),
        usdc_mint: ctx.accounts.usdc_mint.key(),
        repay_reserve: ctx.accounts.repay_reserve.key(),
        collateral_reserve: ctx.accounts.collateral_reserve.key(),
        mark,
        scale: 10u64.pow(ctx.accounts.collateral_mint.decimals.into()),
        authority_bump: ctx.bumps.market_authority,
    });
    ctx.accounts.repay_reserve.set_inner(Reserve {
        market,
        mint: ctx.accounts.usdc_mint.key(),
        supply_vault: ctx.accounts.repay_supply.key(),
    });
    ctx.accounts.collateral_reserve.set_inner(Reserve {
        market,
        mint: ctx.accounts.collateral_mint.key(),
        supply_vault: ctx.accounts.collateral_supply.key(),
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + Market::INIT_SPACE)]
    pub market: Box<Account<'info, Market>>,
    /// CHECK: PDA signer for both supply vaults; holds no data.
    #[account(seeds = [b"authority", market.key().as_ref()], bump)]
    pub market_authority: UncheckedAccount<'info>,
    pub collateral_mint: Box<Account<'info, Mint>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(init, payer = authority, space = 8 + Reserve::INIT_SPACE, seeds = [b"reserve", market.key().as_ref(), usdc_mint.key().as_ref()], bump)]
    pub repay_reserve: Box<Account<'info, Reserve>>,
    #[account(init, payer = authority, space = 8 + Reserve::INIT_SPACE, seeds = [b"reserve", market.key().as_ref(), collateral_mint.key().as_ref()], bump)]
    pub collateral_reserve: Box<Account<'info, Reserve>>,
    #[account(init, payer = authority, seeds = [b"supply", repay_reserve.key().as_ref()], bump, token::mint = usdc_mint, token::authority = market_authority)]
    pub repay_supply: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = authority, seeds = [b"supply", collateral_reserve.key().as_ref()], bump, token::mint = collateral_mint, token::authority = market_authority)]
    pub collateral_supply: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

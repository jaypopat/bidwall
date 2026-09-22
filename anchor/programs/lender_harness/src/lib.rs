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
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

declare_id!("2JHZer7Zz7BKFTdHcnrvqAtPMf7zugw5rGbXT14cUw1N");

pub const LIQUIDATION_THRESHOLD_BPS: u128 = 8_000;

#[program]
pub mod lender_harness {
    use super::*;
    pub fn create_market(ctx: Context<CreateMarket>, mark: u64) -> Result<()> {
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
    pub fn set_mark(ctx: Context<SetMark>, mark: u64) -> Result<()> {
        require!(mark > 0, LenderError::Terms);
        ctx.accounts.market.mark = mark;
        Ok(())
    }
    // Models an already outstanding loan. Authority seeds debt; collateral is actually deposited.
    pub fn open_position(ctx: Context<OpenPosition>, quantity: u64, debt: u64) -> Result<()> {
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
    /// `payment` buys the whole lot; `min_collateral` bounds what the liquidator accepts.
    pub fn liquidate(ctx: Context<Liquidate>, payment: u64, min_collateral: u64) -> Result<()> {
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
}

/// Lender eligibility and terms: (debt to repay, collateral seized). Callers may use
/// this to pre-check; `liquidate` recomputes it from lender-owned state.
pub fn quote(market: &Market, position: &Position) -> Result<(u64, u64)> {
    require!(
        !position.settled && position.debt > 0 && position.quantity > 0,
        LenderError::Replay
    );
    let value = (position.quantity as u128) * (market.mark as u128) / (market.scale as u128);
    let value = u64::try_from(value).map_err(|_| error!(LenderError::Terms))?;
    require!(
        (position.debt as u128) * 10_000 > (value as u128) * LIQUIDATION_THRESHOLD_BPS,
        LenderError::Healthy
    );
    Ok((position.debt, position.quantity))
}

fn pay<'info>(
    from: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    authority: AccountInfo<'info>,
    amount: u64,
    seeds: &[&[&[u8]]],
) -> Result<()> {
    token::transfer_checked(
        CpiContext::new_with_signer(
            token::ID,
            TransferChecked {
                from: from.to_account_info(),
                to: to.to_account_info(),
                mint: mint.to_account_info(),
                authority,
            },
            seeds,
        ),
        amount,
        mint.decimals,
    )
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub authority: Pubkey,
    pub collateral_mint: Pubkey,
    pub usdc_mint: Pubkey,
    pub repay_reserve: Pubkey,
    pub collateral_reserve: Pubkey,
    pub mark: u64,
    pub scale: u64,
    pub authority_bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct Reserve {
    pub market: Pubkey,
    pub mint: Pubkey,
    pub supply_vault: Pubkey,
}
#[account]
#[derive(InitSpace)]
pub struct Position {
    pub market: Pubkey,
    pub borrower: Pubkey,
    pub borrower_usdc: Pubkey,
    pub quantity: u64,
    pub debt: u64,
    pub settled: bool,
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
#[derive(Accounts)]
pub struct SetMark<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub market: Account<'info, Market>,
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

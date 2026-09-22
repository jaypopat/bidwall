use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

declare_id!("HQhMdM6YjEdrHzD6TGeDLrTCF491EiQntRRpA9Hs2g37");
#[cfg(test)]
mod tests;

#[program]
pub mod bidwall {
    use super::*;
    // Local prototype harness. Market creation is explicit, never a claim of lender approval.
    pub fn create_market(ctx: Context<CreateMarket>, keeper: Pubkey, mark: u64) -> Result<()> {
        require!(
            mark > 0 && ctx.accounts.collateral_mint.decimals <= 9,
            ErrorCode::Terms
        );
        require!(ctx.accounts.usdc_mint.decimals == 6, ErrorCode::Terms);
        require_keys_neq!(
            ctx.accounts.collateral_mint.key(),
            ctx.accounts.usdc_mint.key(),
            ErrorCode::Terms
        );
        ctx.accounts.market.set_inner(Market {
            authority: ctx.accounts.authority.key(),
            keeper,
            collateral_mint: ctx.accounts.collateral_mint.key(),
            usdc_mint: ctx.accounts.usdc_mint.key(),
            mark,
            scale: 10u64.pow(ctx.accounts.collateral_mint.decimals.into()),
        });
        Ok(())
    }
    pub fn set_mark(ctx: Context<SetMark>, mark: u64) -> Result<()> {
        require!(mark > 0, ErrorCode::Terms);
        ctx.accounts.market.mark = mark;
        Ok(())
    }
    // Models an already outstanding loan. Authority seeds debt; collateral is actually deposited.
    pub fn open_position(ctx: Context<OpenPosition>, quantity: u64, debt: u64) -> Result<()> {
        require!(quantity > 0 && debt > 0, ErrorCode::Terms);
        pay(
            &ctx.accounts.source,
            &ctx.accounts.collateral_vault,
            &ctx.accounts.collateral_mint,
            ctx.accounts.authority.to_account_info(),
            quantity,
            &[],
        )?;
        ctx.accounts.position.set_inner(Position {
            market: ctx.accounts.market.key(),
            borrower: ctx.accounts.borrower.key(),
            quantity,
            debt,
            settled: false,
        });
        Ok(())
    }
    pub fn create_bid(
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
            adapter: crate::ID,
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
    pub fn fund_bid(ctx: Context<ProviderBid>) -> Result<()> {
        require!(ctx.accounts.bid.state == BidState::Draft, ErrorCode::State);
        require!(
            Clock::get()?.unix_timestamp < ctx.accounts.bid.expiry,
            ErrorCode::Window
        );
        pay(
            &ctx.accounts.provider_usdc,
            &ctx.accounts.escrow,
            &ctx.accounts.usdc_mint,
            ctx.accounts.provider.to_account_info(),
            ctx.accounts.bid.remaining_funds,
            &[],
        )?;
        ctx.accounts.bid.state = BidState::Funded;
        Ok(())
    }
    pub fn activate_bid(ctx: Context<ProviderBid>) -> Result<()> {
        require!(ctx.accounts.bid.state == BidState::Funded, ErrorCode::State);
        require!(
            Clock::get()?.unix_timestamp < ctx.accounts.bid.expiry,
            ErrorCode::Window
        );
        require!(
            ctx.accounts.escrow.amount >= ctx.accounts.bid.remaining_funds,
            ErrorCode::Capacity
        );
        ctx.accounts.bid.state = BidState::Active;
        Ok(())
    }
    pub fn withdraw_bid(ctx: Context<ProviderBid>) -> Result<()> {
        require!(
            Clock::get()?.unix_timestamp >= ctx.accounts.bid.expiry,
            ErrorCode::Window
        );
        require!(
            ctx.accounts.bid.state != BidState::Withdrawn,
            ErrorCode::State
        );
        let b = &ctx.accounts.bid;
        let id = b.id.to_le_bytes();
        let bump = [b.bump];
        let seeds: &[&[u8]] = &[b"bid", b.provider.as_ref(), &id, &bump];
        pay(
            &ctx.accounts.escrow,
            &ctx.accounts.provider_usdc,
            &ctx.accounts.usdc_mint,
            b.to_account_info(),
            ctx.accounts.escrow.amount,
            &[seeds],
        )?;
        ctx.accounts.bid.remaining_funds = 0;
        ctx.accounts.bid.state = BidState::Withdrawn;
        Ok(())
    }
    pub fn settle(ctx: Context<Settle>, expected_remaining: u64) -> Result<()> {
        let b = &ctx.accounts.bid;
        let p = &ctx.accounts.position;
        let now = Clock::get()?.unix_timestamp;
        require!(b.state == BidState::Active, ErrorCode::State);
        require!(now >= b.start && now < b.expiry, ErrorCode::Window);
        require!(!p.settled, ErrorCode::Replay);
        require!(
            b.remaining_quantity == expected_remaining,
            ErrorCode::Replay
        );
        require!(p.quantity <= b.remaining_quantity, ErrorCode::Capacity);
        let value = consideration(
            p.quantity,
            ctx.accounts.market.mark,
            ctx.accounts.market.scale,
        )?;
        require!(
            (p.debt as u128) * 10_000 > (value as u128) * 8_000,
            ErrorCode::Healthy
        );
        // Cumulative rounding prevents many small fills from draining more than full funding.
        let filled = b.quantity - b.remaining_quantity;
        let proceeds = consideration(filled + p.quantity, b.price, ctx.accounts.market.scale)?
            - consideration(filled, b.price, ctx.accounts.market.scale)?;
        require!(
            proceeds >= p.debt && proceeds <= b.remaining_funds,
            ErrorCode::Capacity
        );
        let id = b.id.to_le_bytes();
        let bump = [b.bump];
        let seeds: &[&[u8]] = &[b"bid", b.provider.as_ref(), &id, &bump];
        // Pay debt first. A failure in collateral delivery below must roll this CPI back.
        pay(
            &ctx.accounts.escrow,
            &ctx.accounts.debt_vault,
            &ctx.accounts.usdc_mint,
            b.to_account_info(),
            p.debt,
            &[seeds],
        )?;
        pay(
            &ctx.accounts.escrow,
            &ctx.accounts.borrower_usdc,
            &ctx.accounts.usdc_mint,
            b.to_account_info(),
            proceeds - p.debt,
            &[seeds],
        )?;
        let position_key = p.key();
        let vb = [ctx.bumps.collateral_vault];
        let collateral_seeds: &[&[u8]] = &[b"collateral", position_key.as_ref(), &vb];
        pay(
            &ctx.accounts.collateral_vault,
            &ctx.accounts.provider_collateral,
            &ctx.accounts.collateral_mint,
            ctx.accounts.collateral_vault.to_account_info(),
            p.quantity,
            &[collateral_seeds],
        )?;
        let quantity = p.quantity;
        let debt = p.debt;
        ctx.accounts.position.debt = 0;
        ctx.accounts.position.quantity = 0;
        ctx.accounts.position.settled = true;
        ctx.accounts.bid.remaining_quantity -= quantity;
        ctx.accounts.bid.remaining_funds -= proceeds;
        if ctx.accounts.bid.remaining_quantity == 0 {
            ctx.accounts.bid.state = BidState::Exhausted;
        }
        emit!(Settlement {
            bid: ctx.accounts.bid.key(),
            position: position_key,
            quantity,
            proceeds,
            debt,
            residual: proceeds - debt,
            remaining_quantity: ctx.accounts.bid.remaining_quantity,
            remaining_funds: ctx.accounts.bid.remaining_funds
        });
        Ok(())
    }
}

pub fn consideration(quantity: u64, price: u64, scale: u64) -> Result<u64> {
    require!(scale > 0, ErrorCode::Terms);
    u64::try_from((quantity as u128) * (price as u128) / (scale as u128))
        .map_err(|_| error!(ErrorCode::Arithmetic))
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
    pub keeper: Pubkey,
    pub collateral_mint: Pubkey,
    pub usdc_mint: Pubkey,
    pub mark: u64,
    pub scale: u64,
}
#[account]
#[derive(InitSpace)]
pub struct Position {
    pub market: Pubkey,
    pub borrower: Pubkey,
    pub quantity: u64,
    pub debt: u64,
    pub settled: bool,
}
#[account]
#[derive(InitSpace)]
pub struct Bid {
    pub provider: Pubkey,
    pub market: Pubkey,
    pub adapter: Pubkey,
    pub id: u64,
    pub price: u64,
    pub quantity: u64,
    pub remaining_quantity: u64,
    pub remaining_funds: u64,
    pub start: i64,
    pub expiry: i64,
    pub state: BidState,
    pub bump: u8,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum BidState {
    Draft,
    Funded,
    Active,
    Exhausted,
    Withdrawn,
}
#[event]
pub struct Settlement {
    pub bid: Pubkey,
    pub position: Pubkey,
    pub quantity: u64,
    pub proceeds: u64,
    pub debt: u64,
    pub residual: u64,
    pub remaining_quantity: u64,
    pub remaining_funds: u64,
}

#[derive(Accounts)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + Market::INIT_SPACE)]
    pub market: Account<'info, Market>,
    pub collateral_mint: Box<Account<'info, Mint>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(init, payer = authority, seeds = [b"debt", market.key().as_ref()], bump, token::mint = usdc_mint, token::authority = market)]
    pub debt_vault: Box<Account<'info, TokenAccount>>,
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
    #[account(has_one = authority, has_one = collateral_mint)]
    pub market: Account<'info, Market>,
    /// CHECK: Stored recipient identity; no privileges are granted.
    pub borrower: UncheckedAccount<'info>,
    #[account(init, payer = authority, space = 8 + Position::INIT_SPACE)]
    pub position: Account<'info, Position>,
    pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = collateral_mint, token::authority = authority)]
    pub source: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = authority, seeds = [b"collateral", position.key().as_ref()], bump, token::mint = collateral_mint, token::authority = collateral_vault)]
    pub collateral_vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
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
#[derive(Accounts)]
pub struct Settle<'info> {
    pub keeper: Signer<'info>,
    #[account(has_one = keeper, has_one = usdc_mint, has_one = collateral_mint)]
    pub market: Account<'info, Market>,
    #[account(mut, has_one = market, seeds = [b"bid", bid.provider.as_ref(), &bid.id.to_le_bytes()], bump = bid.bump, constraint = bid.adapter == crate::ID)]
    pub bid: Account<'info, Bid>,
    #[account(mut, has_one = market)]
    pub position: Account<'info, Position>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [b"escrow", bid.key().as_ref()], bump, token::mint = usdc_mint, token::authority = bid)]
    pub escrow: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [b"debt", market.key().as_ref()], bump, token::mint = usdc_mint, token::authority = market)]
    pub debt_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = usdc_mint, constraint = borrower_usdc.owner == position.borrower)]
    pub borrower_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [b"collateral", position.key().as_ref()], bump, token::mint = collateral_mint, token::authority = collateral_vault)]
    pub collateral_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = collateral_mint, constraint = provider_collateral.owner == bid.provider)]
    pub provider_collateral: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}
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
    #[msg("Position is not liquidatable at harness threshold")]
    Healthy,
    #[msg("Integer overflow")]
    Arithmetic,
}

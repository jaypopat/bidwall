//! Atomic settlement across the lender boundary.
//!
//! 1. Quote: check bid state/time/replay and read lender eligibility from lender-owned
//!    accounts; price the fill at the bid's fixed price.
//! 2. Approve: the bid PDA approves a data-less liquidator PDA for exactly the fill's
//!    proceeds. The lender never receives the bid PDA's signature.
//! 3. Liquidate: CPI into the pinned lender program with the liquidator PDA as signer.
//! 4. Verify: reload every affected balance and the position; require the exact cash flow
//!    the quote implies. Any mismatch reverts the whole transaction.
//! 5. Consume capacity and emit `Settlement`.
use crate::{
    error::ErrorCode,
    math::consideration,
    state::{Bid, BidState, Market, Settlement},
};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Approve, Mint, Token, TokenAccount};
use lender_harness::program::LenderHarness;

pub fn handler(ctx: Context<Settle>, expected_remaining: u64) -> Result<()> {
    let fill = quote(ctx.accounts, expected_remaining)?;
    let before = Balances::read(ctx.accounts);
    approve_fill(ctx.accounts, fill.proceeds)?;
    liquidate(ctx.accounts, ctx.bumps.liquidator, &fill)?;
    let a = &mut *ctx.accounts;
    a.reload_lender_effects()?;
    require!(
        Balances::read(a) == before.after(&fill).ok_or(ErrorCode::LenderMismatch)?,
        ErrorCode::LenderMismatch
    );
    require!(
        a.escrow.delegate.is_none() && a.escrow.delegated_amount == 0,
        ErrorCode::LenderMismatch
    );
    require!(
        a.position.settled && a.position.debt == 0 && a.position.quantity == 0,
        ErrorCode::LenderMismatch
    );
    consume(a, &fill)
}

/// Terms of one fill: lender-determined debt and lot, Bidwall-determined proceeds.
struct Fill {
    debt: u64,
    quantity: u64,
    proceeds: u64,
}

fn quote(a: &Settle, expected_remaining: u64) -> Result<Fill> {
    let (b, p) = (&a.bid, &a.position);
    let now = Clock::get()?.unix_timestamp;
    require!(b.state == BidState::Active, ErrorCode::State);
    require!(now >= b.start && now < b.expiry, ErrorCode::Window);
    require!(
        !p.settled && p.debt > 0 && p.quantity > 0,
        ErrorCode::Replay
    );
    require!(
        b.remaining_quantity == expected_remaining,
        ErrorCode::Replay
    );
    // Lender eligibility, read before any allowance is granted. The lender recomputes it.
    let (debt, quantity) =
        lender_harness::quote(&a.lender_market, p).map_err(|_| error!(ErrorCode::Healthy))?;
    require!(quantity <= b.remaining_quantity, ErrorCode::Capacity);
    // Cumulative rounding prevents many small fills from draining more than full funding.
    let filled = b.quantity - b.remaining_quantity;
    let proceeds = consideration(filled + quantity, b.price, a.market.scale)?
        - consideration(filled, b.price, a.market.scale)?;
    require!(
        proceeds >= debt && proceeds <= b.remaining_funds,
        ErrorCode::Capacity
    );
    // Balance deltas are only meaningful for distinct accounts.
    require!(
        a.escrow.key() != a.borrower_usdc.key()
            && a.escrow.key() != a.repay_supply.key()
            && a.borrower_usdc.key() != a.repay_supply.key()
            && a.provider_collateral.key() != a.collateral_supply.key(),
        ErrorCode::LenderMismatch
    );
    Ok(Fill {
        debt,
        quantity,
        proceeds,
    })
}

fn approve_fill(a: &Settle, proceeds: u64) -> Result<()> {
    let (id, bump) = (a.bid.id.to_le_bytes(), [a.bid.bump]);
    token::approve(
        CpiContext::new_with_signer(
            token::ID,
            Approve {
                to: a.escrow.to_account_info(),
                delegate: a.liquidator.to_account_info(),
                authority: a.bid.to_account_info(),
            },
            &[&a.bid.signer_seeds(&id, &bump)],
        ),
        proceeds,
    )
}

fn liquidate(a: &Settle, liquidator_bump: u8, fill: &Fill) -> Result<()> {
    let bid = a.bid.key();
    let bump = [liquidator_bump];
    let seeds: &[&[u8]] = &[b"liquidator", bid.as_ref(), &bump];
    lender_harness::cpi::liquidate(
        CpiContext::new_with_signer(
            lender_harness::ID,
            lender_harness::cpi::accounts::Liquidate {
                liquidator: a.liquidator.to_account_info(),
                market: a.lender_market.to_account_info(),
                market_authority: a.market_authority.to_account_info(),
                repay_reserve: a.repay_reserve.to_account_info(),
                collateral_reserve: a.collateral_reserve.to_account_info(),
                position: a.position.to_account_info(),
                usdc_mint: a.usdc_mint.to_account_info(),
                collateral_mint: a.collateral_mint.to_account_info(),
                source_usdc: a.escrow.to_account_info(),
                repay_supply: a.repay_supply.to_account_info(),
                collateral_supply: a.collateral_supply.to_account_info(),
                destination_collateral: a.provider_collateral.to_account_info(),
                borrower_usdc: a.borrower_usdc.to_account_info(),
                token_program: a.token_program.to_account_info(),
            },
            &[seeds],
        ),
        fill.proceeds,
        fill.quantity,
    )
}

fn consume(a: &mut Settle, fill: &Fill) -> Result<()> {
    let bid = &mut a.bid;
    bid.remaining_quantity -= fill.quantity;
    bid.remaining_funds -= fill.proceeds;
    if bid.remaining_quantity == 0 {
        bid.state = BidState::Exhausted;
    }
    emit!(Settlement {
        bid: bid.key(),
        lender_market: a.lender_market.key(),
        position: a.position.key(),
        quantity: fill.quantity,
        proceeds: fill.proceeds,
        debt: fill.debt,
        residual: fill.proceeds - fill.debt,
        remaining_quantity: bid.remaining_quantity,
        remaining_funds: bid.remaining_funds
    });
    Ok(())
}

/// Every token balance the lender CPI may change.
#[derive(PartialEq)]
struct Balances {
    escrow: u64,
    repay_supply: u64,
    borrower_usdc: u64,
    collateral_supply: u64,
    provider_collateral: u64,
}

impl Balances {
    fn read(a: &Settle) -> Self {
        Self {
            escrow: a.escrow.amount,
            repay_supply: a.repay_supply.amount,
            borrower_usdc: a.borrower_usdc.amount,
            collateral_supply: a.collateral_supply.amount,
            provider_collateral: a.provider_collateral.amount,
        }
    }
    /// Balances after a correct liquidation: escrow pays proceeds, the lender receives
    /// the debt, the borrower receives the residual and the provider receives the lot.
    fn after(&self, fill: &Fill) -> Option<Self> {
        Some(Self {
            escrow: self.escrow.checked_sub(fill.proceeds)?,
            repay_supply: self.repay_supply.checked_add(fill.debt)?,
            borrower_usdc: self.borrower_usdc.checked_add(fill.proceeds - fill.debt)?,
            collateral_supply: self.collateral_supply.checked_sub(fill.quantity)?,
            provider_collateral: self.provider_collateral.checked_add(fill.quantity)?,
        })
    }
}

#[derive(Accounts)]
pub struct Settle<'info> {
    pub keeper: Signer<'info>,
    #[account(has_one = keeper, has_one = usdc_mint, has_one = collateral_mint, has_one = lender_market, has_one = lender_program)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, has_one = market, seeds = [b"bid", bid.provider.as_ref(), &bid.id.to_le_bytes()], bump = bid.bump, constraint = bid.adapter == lender_program.key() @ ErrorCode::Terms)]
    pub bid: Box<Account<'info, Bid>>,
    #[account(mut, seeds = [b"escrow", bid.key().as_ref()], bump, token::mint = usdc_mint, token::authority = bid)]
    pub escrow: Box<Account<'info, TokenAccount>>,
    /// CHECK: Data-less PDA; the only signer the lender receives, limited by its allowance.
    #[account(seeds = [b"liquidator", bid.key().as_ref()], bump)]
    pub liquidator: UncheckedAccount<'info>,
    #[account(mut, token::mint = collateral_mint, constraint = provider_collateral.owner == bid.provider)]
    pub provider_collateral: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub collateral_mint: Box<Account<'info, Mint>>,

    // Lender side. Typed accounts enforce lender-program ownership and discriminators;
    // addresses are pinned to what the lender market and position record.
    pub lender_program: Program<'info, LenderHarness>,
    pub lender_market: Box<Account<'info, lender_harness::Market>>,
    /// CHECK: Lender market authority PDA, derived under the lender program.
    #[account(seeds = [b"authority", lender_market.key().as_ref()], bump = lender_market.authority_bump, seeds::program = lender_program.key())]
    pub market_authority: UncheckedAccount<'info>,
    #[account(address = lender_market.repay_reserve)]
    pub repay_reserve: Box<Account<'info, lender_harness::Reserve>>,
    #[account(address = lender_market.collateral_reserve)]
    pub collateral_reserve: Box<Account<'info, lender_harness::Reserve>>,
    #[account(mut, constraint = position.market == lender_market.key() @ ErrorCode::Terms)]
    pub position: Box<Account<'info, lender_harness::Position>>,
    #[account(mut, address = repay_reserve.supply_vault)]
    pub repay_supply: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = collateral_reserve.supply_vault)]
    pub collateral_supply: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = position.borrower_usdc)]
    pub borrower_usdc: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

impl Settle<'_> {
    fn reload_lender_effects(&mut self) -> Result<()> {
        self.escrow.reload()?;
        self.repay_supply.reload()?;
        self.borrower_usdc.reload()?;
        self.collateral_supply.reload()?;
        self.provider_collateral.reload()?;
        self.position.reload()
    }
}

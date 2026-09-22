//! TEST FIXTURE ONLY. Simulates a compromised upgrade of the pinned lender program:
//! it shares the lender harness's program ID and instruction interface, takes the
//! liquidator's allowance and delivers no collateral or borrower residual. Tests load
//! it in place of the honest lender to prove Bidwall's post-CPI verification. Never deploy.
use anchor_lang::prelude::*;
use anchor_spl::token::{self, TransferChecked};

declare_id!("2JHZer7Zz7BKFTdHcnrvqAtPMf7zugw5rGbXT14cUw1N");

#[program]
pub mod malicious_lender {
    use super::*;
    pub fn liquidate(ctx: Context<Liquidate>, payment: u64, _min_collateral: u64) -> Result<()> {
        let a = &ctx.accounts;
        token::transfer_checked(
            CpiContext::new(
                token::ID,
                TransferChecked {
                    from: a.source_usdc.to_account_info(),
                    to: a.repay_supply.to_account_info(),
                    mint: a.usdc_mint.to_account_info(),
                    authority: a.liquidator.to_account_info(),
                },
            ),
            payment,
            6, // Test USDC decimals.
        )
    }
}

/// Same account order as `lender_harness::Liquidate`; nothing is validated.
#[derive(Accounts)]
pub struct Liquidate<'info> {
    pub liquidator: Signer<'info>,
    /// CHECK: ignored
    pub market: UncheckedAccount<'info>,
    /// CHECK: ignored
    pub market_authority: UncheckedAccount<'info>,
    /// CHECK: ignored
    pub repay_reserve: UncheckedAccount<'info>,
    /// CHECK: ignored
    pub collateral_reserve: UncheckedAccount<'info>,
    /// CHECK: ignored
    #[account(mut)]
    pub position: UncheckedAccount<'info>,
    /// CHECK: ignored
    pub usdc_mint: UncheckedAccount<'info>,
    /// CHECK: ignored
    pub collateral_mint: UncheckedAccount<'info>,
    /// CHECK: ignored
    #[account(mut)]
    pub source_usdc: UncheckedAccount<'info>,
    /// CHECK: ignored
    #[account(mut)]
    pub repay_supply: UncheckedAccount<'info>,
    /// CHECK: ignored
    #[account(mut)]
    pub collateral_supply: UncheckedAccount<'info>,
    /// CHECK: ignored
    #[account(mut)]
    pub destination_collateral: UncheckedAccount<'info>,
    /// CHECK: ignored
    #[account(mut)]
    pub borrower_usdc: UncheckedAccount<'info>,
    /// CHECK: ignored
    pub token_program: UncheckedAccount<'info>,
}

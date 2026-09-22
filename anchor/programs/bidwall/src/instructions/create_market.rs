use crate::state::Market;
use anchor_lang::prelude::*;

/// Registers a Bidwall market for one lender market. Registration is permissionless and
/// is never a claim of lender approval.
pub fn handler(ctx: Context<CreateMarket>, keeper: Pubkey) -> Result<()> {
    let lender = &ctx.accounts.lender_market;
    ctx.accounts.market.set_inner(Market {
        authority: ctx.accounts.authority.key(),
        keeper,
        lender_program: lender_harness::ID,
        lender_market: lender.key(),
        collateral_mint: lender.collateral_mint,
        usdc_mint: lender.usdc_mint,
        scale: lender.scale,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + Market::INIT_SPACE)]
    pub market: Account<'info, Market>,
    /// Owner and discriminator checks pin this to the lender harness program.
    pub lender_market: Box<Account<'info, lender_harness::Market>>,
    pub system_program: Program<'info, System>,
}

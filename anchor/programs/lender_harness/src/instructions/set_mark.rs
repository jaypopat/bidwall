use crate::{error::LenderError, state::Market};
use anchor_lang::prelude::*;

pub fn handler(ctx: Context<SetMark>, mark: u64) -> Result<()> {
    require!(mark > 0, LenderError::Terms);
    ctx.accounts.market.mark = mark;
    Ok(())
}

#[derive(Accounts)]
pub struct SetMark<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub market: Account<'info, Market>,
}

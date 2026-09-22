use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, TokenAccount, TransferChecked};

/// Classic SPL Token `transfer_checked`; `seeds` is empty unless a PDA signs.
pub fn pay<'info>(
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

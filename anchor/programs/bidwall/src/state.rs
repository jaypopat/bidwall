use anchor_lang::prelude::*;

/// A Bidwall market registered against exactly one external lender market.
#[account]
#[derive(InitSpace)]
pub struct Market {
    pub authority: Pubkey,
    /// The only identity allowed to trigger settlements.
    pub keeper: Pubkey,
    pub lender_program: Pubkey,
    pub lender_market: Pubkey,
    pub collateral_mint: Pubkey,
    pub usdc_mint: Pubkey,
    /// 10^collateral_decimals, copied from the lender market.
    pub scale: u64,
}

/// A funded, fixed-price commitment to buy liquidated collateral.
#[account]
#[derive(InitSpace)]
pub struct Bid {
    pub provider: Pubkey,
    pub market: Pubkey,
    /// Lender program the bid may settle through, pinned at creation.
    pub adapter: Pubkey,
    pub id: u64,
    /// USDC atoms per 10^mint_decimals raw collateral atoms (before UI scaling).
    pub price: u64,
    /// Maximum collateral atoms.
    pub quantity: u64,
    pub remaining_quantity: u64,
    pub remaining_funds: u64,
    pub start: i64,
    pub expiry: i64,
    pub state: BidState,
    pub bump: u8,
}

impl Bid {
    /// Signer seeds for the bid PDA, which owns the escrow.
    pub fn signer_seeds<'a>(&'a self, id: &'a [u8; 8], bump: &'a [u8; 1]) -> [&'a [u8]; 4] {
        [b"bid", self.provider.as_ref(), id, bump]
    }
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
    pub lender_market: Pubkey,
    pub position: Pubkey,
    pub quantity: u64,
    pub proceeds: u64,
    pub debt: u64,
    pub residual: u64,
    pub remaining_quantity: u64,
    pub remaining_funds: u64,
}

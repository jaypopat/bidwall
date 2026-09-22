use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Market {
    /// Test authority: sets the mark and seeds modeled positions.
    pub authority: Pubkey,
    pub collateral_mint: Pubkey,
    pub usdc_mint: Pubkey,
    pub repay_reserve: Pubkey,
    pub collateral_reserve: Pubkey,
    /// Collateral mark in USDC atoms per whole collateral token.
    pub mark: u64,
    /// 10^collateral_decimals.
    pub scale: u64,
    pub authority_bump: u8,
}
/// One side of the market; `supply_vault` is owned by the market authority PDA.
#[account]
#[derive(InitSpace)]
pub struct Reserve {
    pub market: Pubkey,
    pub mint: Pubkey,
    pub supply_vault: Pubkey,
}
/// A modeled outstanding loan.
#[account]
#[derive(InitSpace)]
pub struct Position {
    pub market: Pubkey,
    pub borrower: Pubkey,
    /// Recipient of any liquidation surplus.
    pub borrower_usdc: Pubkey,
    pub quantity: u64,
    pub debt: u64,
    pub settled: bool,
}

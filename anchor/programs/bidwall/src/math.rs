use crate::error::ErrorCode;
use anchor_lang::prelude::*;

/// USDC atoms owed for `quantity` collateral atoms at `price` USDC atoms per whole token,
/// rounded down. `scale` is 10^collateral_decimals.
pub fn consideration(quantity: u64, price: u64, scale: u64) -> Result<u64> {
    require!(scale > 0, ErrorCode::Terms);
    u64::try_from((quantity as u128) * (price as u128) / (scale as u128))
        .map_err(|_| error!(ErrorCode::Arithmetic))
}

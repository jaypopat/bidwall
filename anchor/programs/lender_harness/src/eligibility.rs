use crate::{
    error::LenderError,
    state::{Market, Position},
};
use anchor_lang::prelude::*;

/// Debt must exceed this share of marked collateral value, in basis points.
pub const LIQUIDATION_THRESHOLD_BPS: u128 = 8_000;

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

//! Narrow adapter for the public xStocks NVDAx/USDC reserve pair. All amounts are
//! raw token atoms, including NVDAx's scaled-UI mint. No UI multiplier is applied.
use crate::{consideration, transfer::pay, Bid, BidState, ErrorCode, Market, Settlement};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use anchor_spl::{
    token::{self, Mint, Token, TokenAccount},
    token_2022::Token2022,
    token_interface,
};

pub const KLEND: Pubkey = pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
pub const LENDING_MARKET: Pubkey = pubkey!("5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua");
pub const NVDA_RESERVE: Pubkey = pubkey!("7B66Az3tJhAo4bLkX8PzTixQ9ZGyHkkjxfVLhF26sP5q");
pub const USDC_RESERVE: Pubkey = pubkey!("97zoywd8mPZsGTg8q1wdD2Wgkdrs2tqusp1Qqcxbyj7E");
pub const NVDA_MINT: Pubkey = pubkey!("Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh");
pub const USDC_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
pub const FARMS: Pubkey = pubkey!("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr");
pub struct Kamino;
impl Id for Kamino {
    fn id() -> Pubkey {
        KLEND
    }
}

pub fn register(ctx: Context<CreateKaminoMarket>, keeper: Pubkey) -> Result<()> {
    require!(
        ctx.accounts.usdc_mint.decimals == 6 && ctx.accounts.collateral_mint.decimals == 8,
        ErrorCode::Terms
    );
    ctx.accounts.market.set_inner(Market {
        authority: ctx.accounts.authority.key(),
        keeper,
        lender_program: KLEND,
        lender_market: LENDING_MARKET,
        collateral_mint: NVDA_MINT,
        usdc_mint: USDC_MINT,
        scale: 100_000_000,
    });
    Ok(())
}

/// Bind execution to the observed collateral deposit and bid capacity. Interest
/// accrual during native refresh does not invalidate the quote. A liquidation changes
/// both guards; Kamino itself checks eligibility and freshness.
pub fn execute<'info>(
    ctx: Context<'info, SettleKamino<'info>>,
    max_repay: u64,
    min_collateral: u64,
    expected_remaining: u64,
    expected_deposited_ctokens: u64,
) -> Result<()> {
    let a = &mut *ctx.accounts;
    let now = Clock::get()?.unix_timestamp;
    require!(a.bid.state == BidState::Active, ErrorCode::State);
    require!(now >= a.bid.start && now < a.bid.expiry, ErrorCode::Window);
    require!(
        a.bid.remaining_quantity == expected_remaining,
        ErrorCode::Replay
    );
    require!(
        max_repay > 0 && min_collateral > 0 && max_repay <= a.bid.remaining_funds,
        ErrorCode::Capacity
    );
    let before_position = validate(a, ctx.remaining_accounts)?;
    require!(
        before_position.collateral == expected_deposited_ctokens && before_position.debt > 0,
        ErrorCode::Replay
    );
    let before = (
        a.escrow.amount,
        a.source_usdc.amount,
        a.destination_collateral.amount,
        a.destination_ctoken.amount,
        a.repay_supply.amount,
        a.provider_collateral.amount,
        a.borrower_usdc.amount,
    );
    let id = a.bid.id.to_le_bytes();
    let bid_bump = [a.bid.bump];
    let bid_seeds = a.bid.signer_seeds(&id, &bid_bump);
    // The lender receives only a bounded temporary budget, never escrow authority.
    pay(
        &a.escrow,
        &a.source_usdc,
        &a.usdc_mint,
        a.bid.to_account_info(),
        max_repay,
        &[&bid_seeds],
    )?;
    let bid_key = a.bid.key();
    let bump = [ctx.bumps.liquidator];
    let seeds: &[&[u8]] = &[b"kamino_liquidator", bid_key.as_ref(), &bump];
    let mut data = vec![162, 161, 35, 143, 30, 187, 185, 103];
    data.extend_from_slice(&max_repay.to_le_bytes());
    data.extend_from_slice(&min_collateral.to_le_bytes());
    data.extend_from_slice(&0u64.to_le_bytes()); // Never enable the staging LTV override.
    let writable = [1usize, 4, 6, 7, 9, 10, 11, 12, 13, 14, 15, 22, 23, 25];
    let metas = ctx
        .remaining_accounts
        .iter()
        .enumerate()
        .map(|(i, account)| AccountMeta {
            pubkey: account.key(),
            is_signer: i == 0,
            is_writable: writable.contains(&i),
        })
        .collect();
    invoke_signed(
        &Instruction {
            program_id: KLEND,
            accounts: metas,
            data,
        },
        ctx.remaining_accounts,
        &[seeds],
    )?;
    a.source_usdc.reload()?;
    a.destination_collateral.reload()?;
    a.destination_ctoken.reload()?;
    a.repay_supply.reload()?;
    let spent = before
        .1
        .checked_add(max_repay)
        .and_then(|v| v.checked_sub(a.source_usdc.amount))
        .ok_or(ErrorCode::LenderMismatch)?;
    let received = a
        .destination_collateral
        .amount
        .checked_sub(before.2)
        .ok_or(ErrorCode::LenderMismatch)?;
    let after_position = position(&ctx.remaining_accounts[1])?;
    require!(
        spent > 0
            && spent <= max_repay
            && received >= min_collateral
            && received <= a.bid.remaining_quantity,
        ErrorCode::Capacity
    );
    require!(
        a.destination_ctoken.amount == before.3
            && a.repay_supply.amount.checked_sub(before.4) == Some(spent),
        ErrorCode::LenderMismatch
    );
    // Kamino repays fractional debt and rounds its token transfer up to the atom.
    let debt_reduction = before_position
        .debt
        .checked_sub(after_position.debt)
        .ok_or(ErrorCode::LenderMismatch)?;
    require!(
        debt_reduction > 0
            && debt_reduction.div_ceil(1u128 << 60) == spent as u128
            && after_position.collateral < before_position.collateral
            && after_position.owner == before_position.owner,
        ErrorCode::LenderMismatch
    );
    let filled = a.bid.quantity - a.bid.remaining_quantity;
    let proceeds = consideration(filled + received, a.bid.price, 100_000_000)?
        - consideration(filled, a.bid.price, 100_000_000)?;
    require!(
        proceeds >= spent && proceeds <= a.bid.remaining_funds,
        ErrorCode::Capacity
    );
    // Return unused repayment budget, then pay the fixed-bid surplus to the loan owner.
    pay(
        &a.source_usdc,
        &a.escrow,
        &a.usdc_mint,
        a.liquidator.to_account_info(),
        max_repay - spent,
        &[seeds],
    )?;
    pay(
        &a.escrow,
        &a.borrower_usdc,
        &a.usdc_mint,
        a.bid.to_account_info(),
        proceeds - spent,
        &[&bid_seeds],
    )?;
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            a.collateral_token_program.key(),
            token_interface::TransferChecked {
                from: a.destination_collateral.to_account_info(),
                to: a.provider_collateral.to_account_info(),
                mint: a.collateral_mint.to_account_info(),
                authority: a.liquidator.to_account_info(),
            },
            &[seeds],
        ),
        received,
        8,
    )?;
    a.escrow.reload()?;
    a.source_usdc.reload()?;
    a.destination_collateral.reload()?;
    a.provider_collateral.reload()?;
    a.borrower_usdc.reload()?;
    require!(
        a.source_usdc.amount == before.1
            && a.destination_collateral.amount == before.2
            && before.0.checked_sub(a.escrow.amount) == Some(proceeds)
            && a.provider_collateral.amount.checked_sub(before.5) == Some(received)
            && a.borrower_usdc.amount.checked_sub(before.6) == Some(proceeds - spent),
        ErrorCode::LenderMismatch
    );
    a.bid.remaining_quantity -= received;
    a.bid.remaining_funds -= proceeds;
    if a.bid.remaining_quantity == 0 {
        a.bid.state = BidState::Exhausted;
    }
    emit!(Settlement {
        bid: bid_key,
        lender_market: LENDING_MARKET,
        position: ctx.remaining_accounts[1].key(),
        quantity: received,
        proceeds,
        debt: spent,
        residual: proceeds - spent,
        remaining_quantity: a.bid.remaining_quantity,
        remaining_funds: a.bid.remaining_funds
    });
    Ok(())
}

struct Position {
    owner: Pubkey,
    debt: u128,
    collateral: u64,
}
fn key(data: &[u8], offset: usize) -> Result<Pubkey> {
    Ok(Pubkey::new_from_array(
        data.get(offset..offset + 32)
            .ok_or(ErrorCode::Terms)?
            .try_into()
            .map_err(|_| ErrorCode::Terms)?,
    ))
}
fn number<const N: usize>(data: &[u8], offset: usize) -> Result<[u8; N]> {
    data.get(offset..offset + N)
        .ok_or_else(|| error!(ErrorCode::Terms))?
        .try_into()
        .map_err(|_| error!(ErrorCode::Terms))
}
fn check(info: &AccountInfo, size: usize, discriminator: &[u8]) -> Result<()> {
    require_keys_eq!(*info.owner, KLEND, ErrorCode::Terms);
    let d = info.try_borrow_data()?;
    require!(
        d.len() == size && d.get(..8) == Some(discriminator),
        ErrorCode::Terms
    );
    Ok(())
}
fn position(info: &AccountInfo) -> Result<Position> {
    check(info, 3344, &[168, 206, 141, 106, 88, 76, 172, 167])?;
    let d = info.try_borrow_data()?;
    require_keys_eq!(key(&d, 32)?, LENDING_MARKET, ErrorCode::Terms);
    let collateral = u64::from_le_bytes(number(&d, 128)?);
    let debt = u128::from_le_bytes(number(&d, 1296)?);
    require!(
        key(&d, 96)? == NVDA_RESERVE || (key(&d, 96)? == Pubkey::default() && collateral == 0),
        ErrorCode::Terms
    );
    require!(
        key(&d, 1208)? == USDC_RESERVE || (key(&d, 1208)? == Pubkey::default() && debt == 0),
        ErrorCode::Terms
    );
    for i in 1..8 {
        require_keys_eq!(key(&d, 96 + i * 136)?, Pubkey::default(), ErrorCode::Terms);
    }
    for i in 1..5 {
        require_keys_eq!(
            key(&d, 1208 + i * 200)?,
            Pubkey::default(),
            ErrorCode::Terms
        );
    }
    Ok(Position {
        owner: key(&d, 64)?,
        collateral: u64::from_le_bytes(number(&d, 128)?),
        debt: u128::from_le_bytes(number(&d, 1296)?),
    })
}
fn validate(a: &SettleKamino, r: &[AccountInfo]) -> Result<Position> {
    require!(r.len() == 26, ErrorCode::Terms);
    check(&r[2], 4664, &[246, 114, 50, 98, 72, 157, 28, 120])?;
    for index in [4, 7] {
        check(&r[index], 8624, &[43, 242, 204, 202, 26, 247, 59, 127])?;
    }
    let u = r[4].try_borrow_data()?;
    let n = r[7].try_borrow_data()?;
    require_keys_eq!(key(&u, 32)?, LENDING_MARKET, ErrorCode::Terms);
    require_keys_eq!(key(&n, 32)?, LENDING_MARKET, ErrorCode::Terms);
    require_keys_eq!(key(&u, 128)?, USDC_MINT, ErrorCode::Terms);
    require_keys_eq!(key(&n, 128)?, NVDA_MINT, ErrorCode::Terms);
    require_keys_eq!(key(&n, 64)?, Pubkey::default(), ErrorCode::Terms); // this pair has no collateral farm
    let debt_farm = key(&u, 96)?;
    let farm_user =
        Pubkey::find_program_address(&[b"user", debt_farm.as_ref(), r[1].key.as_ref()], &FARMS).0;
    let authority = Pubkey::find_program_address(&[b"lma", LENDING_MARKET.as_ref()], &KLEND).0;
    let expected = [
        a.liquidator.key(),
        r[1].key(),
        LENDING_MARKET,
        authority,
        USDC_RESERVE,
        USDC_MINT,
        key(&u, 160)?,
        NVDA_RESERVE,
        NVDA_MINT,
        key(&n, 2560)?,
        key(&n, 2600)?,
        key(&n, 160)?,
        key(&n, 192)?,
        a.source_usdc.key(),
        a.destination_ctoken.key(),
        a.destination_collateral.key(),
        token::ID,
        token::ID,
        anchor_spl::token_2022::ID,
        pubkey!("Sysvar1nstructions1111111111111111111111111"),
        KLEND,
        KLEND,
        farm_user,
        debt_farm,
        FARMS,
        NVDA_RESERVE,
    ];
    for (actual, expected) in r.iter().zip(expected) {
        require_keys_eq!(actual.key(), expected, ErrorCode::Terms);
    }
    require_keys_eq!(a.repay_supply.key(), r[6].key(), ErrorCode::Terms);
    require_keys_eq!(a.destination_ctoken.mint, r[9].key(), ErrorCode::Terms);
    let p = position(&r[1])?;
    require_keys_eq!(a.borrower_usdc.owner, p.owner, ErrorCode::Terms);
    // No aliases between payment recipients or between delivered and intermediate collateral.
    let payment = [
        a.escrow.key(),
        a.source_usdc.key(),
        a.borrower_usdc.key(),
        a.repay_supply.key(),
    ];
    for i in 0..payment.len() {
        for j in i + 1..payment.len() {
            require_keys_neq!(payment[i], payment[j], ErrorCode::Terms);
        }
    }
    require_keys_neq!(
        a.destination_collateral.key(),
        a.provider_collateral.key(),
        ErrorCode::Terms
    );
    Ok(p)
}

#[derive(Accounts)]
pub struct CreateKaminoMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init,payer=authority,space=8+Market::INIT_SPACE)]
    pub market: Account<'info, Market>,
    #[account(address=USDC_MINT)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(address=NVDA_MINT, mint::token_program=collateral_token_program)]
    pub collateral_mint: Box<InterfaceAccount<'info, token_interface::Mint>>,
    pub collateral_token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct SettleKamino<'info> {
    pub keeper: Signer<'info>,
    #[account(has_one=keeper,has_one=usdc_mint,has_one=collateral_mint, constraint=market.lender_program==KLEND && market.lender_market==LENDING_MARKET)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut,has_one=market,seeds=[b"bid",bid.provider.as_ref(),&bid.id.to_le_bytes()],bump=bid.bump,constraint=bid.adapter==KLEND)]
    pub bid: Box<Account<'info, Bid>>,
    #[account(mut,seeds=[b"escrow",bid.key().as_ref()],bump,token::mint=usdc_mint,token::authority=bid)]
    pub escrow: Box<Account<'info, TokenAccount>>,
    /// CHECK: PDA owns only intermediate token accounts; never the main escrow.
    #[account(seeds=[b"kamino_liquidator",bid.key().as_ref()],bump)]
    pub liquidator: UncheckedAccount<'info>,
    #[account(address=USDC_MINT)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(address=NVDA_MINT,mint::token_program=collateral_token_program)]
    pub collateral_mint: Box<InterfaceAccount<'info, token_interface::Mint>>,
    #[account(mut,token::mint=usdc_mint,token::authority=liquidator)]
    pub source_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut,token::authority=liquidator)]
    pub destination_ctoken: Box<Account<'info, TokenAccount>>,
    #[account(mut,token::mint=collateral_mint,token::authority=liquidator,token::token_program=collateral_token_program)]
    pub destination_collateral: Box<InterfaceAccount<'info, token_interface::TokenAccount>>,
    #[account(mut,token::mint=collateral_mint,token::token_program=collateral_token_program,constraint=provider_collateral.owner==bid.provider)]
    pub provider_collateral: Box<InterfaceAccount<'info, token_interface::TokenAccount>>,
    #[account(mut,token::mint=usdc_mint)]
    pub borrower_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut,token::mint=usdc_mint)]
    pub repay_supply: Box<Account<'info, TokenAccount>>,
    pub lender_program: Program<'info, Kamino>,
    pub token_program: Program<'info, Token>,
    pub collateral_token_program: Program<'info, Token2022>,
}

//! Successful settlement, capacity accounting and lender eligibility.
use super::*;

#[test]
fn funded_partial_fill_depletion_and_residual_demo() {
    let mut f = Fixture::new();
    assert_eq!(amount(&f.svm, f.escrow), 0);
    f.ready();
    assert_eq!(amount(&f.svm, f.escrow), 9_700_000_000);
    let p = f.position(40_000_000, 3_600_000_000);
    assert_eq!(amount(&f.svm, f.lender.collateral_supply), 40_000_000);
    f.settle(p, 100_000_000).unwrap();
    assert_eq!(amount(&f.svm, f.escrow), 5_820_000_000);
    assert_eq!(amount(&f.svm, f.lender.repay_supply), 3_600_000_000);
    assert_eq!(amount(&f.svm, f.borrower_usdc), 280_000_000);
    assert_eq!(amount(&f.svm, f.provider_collateral), 40_000_000);
    assert_eq!(amount(&f.svm, f.lender.collateral_supply), 0);
    // The per-fill allowance is fully consumed; no standing delegation survives.
    let escrow = SplAccount::unpack(&f.svm.get_account(&f.escrow).unwrap().data).unwrap();
    assert_eq!(escrow.delegate, COption::None);
    assert_eq!(escrow.delegated_amount, 0);
    let b: Bid = read(&f.svm, f.bid);
    assert_eq!(b.remaining_quantity, 60_000_000);
    assert_eq!(b.remaining_funds, 5_820_000_000);
    assert_eq!(b.adapter, lender_harness::ID);
    let position: lender_harness::Position = read(&f.svm, p);
    assert!(position.settled);
    assert_eq!(position.debt, 0);
    let uncovered = f.position(70_000_000, 6_300_000_000);
    let before = f.snapshot(uncovered);
    custom(f.settle(uncovered, 60_000_000), 6003);
    assert_eq!(before, f.snapshot(uncovered));
    let last = f.position(60_000_000, 5_400_000_000);
    f.settle(last, 60_000_000).unwrap();
    assert_eq!(amount(&f.svm, f.escrow), 0);
    assert_eq!(amount(&f.svm, f.provider_collateral), 100_000_000);
    let b: Bid = read(&f.svm, f.bid);
    assert_eq!(b.state, BidState::Exhausted);
    assert_eq!(b.remaining_funds, 0);
    custom(f.settle(uncovered, 0), 6001);
}

#[test]
fn nine_decimal_collateral_uses_base_units() {
    let mut f = Fixture::with_decimals(9);
    f.ready();
    // 100 million atoms = 0.1 token; at 97 USDC/token the budget is 9.7 USDC.
    assert_eq!(amount(&f.svm, f.escrow), 9_700_000);
    let p = f.position(40_000_000, 3_600_000);
    f.settle(p, 100_000_000).unwrap();
    assert_eq!(amount(&f.svm, f.escrow), 5_820_000);
    assert_eq!(amount(&f.svm, f.borrower_usdc), 280_000);
    assert_eq!(amount(&f.svm, f.provider_collateral), 40_000_000);
}

#[test]
fn healthy_and_insufficient_price_fail() {
    let mut f = Fixture::new();
    f.ready();
    let p = f.position(10_000_000, 800_000_000);
    custom(f.settle(p, 100_000_000), 6005);
    let p = f.position(10_000_000, 980_000_000);
    let before = f.snapshot(p);
    custom(f.settle(p, 100_000_000), 6003);
    assert_eq!(before, f.snapshot(p));
}

#[test]
fn lender_mark_authority_and_liquidation_threshold() {
    let mut f = Fixture::new();
    f.ready();
    let p = f.position(10_000_000, 800_000_000);
    custom(f.settle(p, 100_000_000), 6005);
    let set_mark = |authority: Pubkey| {
        lix(
            lender_harness::accounts::SetMark {
                authority,
                market: f.lender.market,
            },
            lender_harness::instruction::SetMark { mark: 90_000_000 },
        )
    };
    let (unauthorized, authorized) = (set_mark(f.provider.pubkey()), set_mark(f.admin.pubkey()));
    custom(send(&mut f.svm, &f.provider, &[unauthorized], &[]), 2001);
    send(&mut f.svm, &f.admin, &[authorized], &[]).unwrap();
    f.settle(p, 100_000_000).unwrap();
}

#[test]
fn replay_and_stale_capacity_fail() {
    let mut f = Fixture::new();
    f.ready();
    let p = f.position(10_000_000, 900_000_000);
    f.settle(p, 100_000_000).unwrap();
    let before = f.snapshot(p);
    custom(f.settle(p, 90_000_000), 6004);
    assert_eq!(before, f.snapshot(p));
    let p = f.position(10_000_000, 900_000_000);
    custom(f.settle(p, 100_000_000), 6004);
}

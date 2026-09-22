//! Atomicity: any failed leg reverts every transfer and state change.
use super::*;

#[test]
fn delivery_failure_rolls_back_successful_payment_cpis() {
    let mut f = Fixture::new();
    f.ready();
    let p = f.position(10_000_000, 900_000_000);
    f.set_token_state(f.provider_collateral, AccountState::Frozen);
    let before = f.snapshot(p);
    let err = f.settle(p, 100_000_000).unwrap_err();
    let count = |needle: &str| err.meta.logs.iter().filter(|l| l.contains(needle)).count();
    // Approval, debt repayment and residual succeeded before collateral delivery failed.
    assert_eq!(count("Instruction: Approve"), 1, "{err:?}");
    assert_eq!(count("Instruction: TransferChecked"), 3, "{err:?}");
    assert_eq!(before, f.snapshot(p));
}

#[test]
fn failed_payment_preserves_debt_and_collateral() {
    let mut f = Fixture::new();
    f.ready();
    let p = f.position(10_000_000, 900_000_000);
    f.set_token_state(f.lender.repay_supply, AccountState::Frozen);
    let before = f.snapshot(p);
    assert!(f.settle(p, 100_000_000).is_err());
    assert_eq!(before, f.snapshot(p));
}

#[test]
fn failed_residual_payment_preserves_debt_and_collateral() {
    let mut f = Fixture::new();
    f.ready();
    let p = f.position(10_000_000, 900_000_000);
    f.set_token_state(f.borrower_usdc, AccountState::Frozen);
    let before = f.snapshot(p);
    assert!(f.settle(p, 100_000_000).is_err());
    assert_eq!(before, f.snapshot(p));
}

#[test]
fn failed_second_instruction_rolls_back_first_settlement() {
    let mut f = Fixture::new();
    f.ready();
    let p = f.position(10_000_000, 900_000_000);
    let before = f.snapshot(p);
    let first = f.settlement(p, 100_000_000);
    let replay = f.settlement(p, 90_000_000);
    custom(send(&mut f.svm, &f.keeper, &[first, replay], &[]), 6004);
    assert_eq!(before, f.snapshot(p));
}

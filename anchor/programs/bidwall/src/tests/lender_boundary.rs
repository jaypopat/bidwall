//! The trust boundary with the lender program itself.
use super::*;

#[test]
fn compromised_lender_cannot_take_payment_without_delivery() {
    let mut f = Fixture::new();
    f.ready();
    let p = f.position(10_000_000, 900_000_000);
    // Simulate a malicious upgrade of the pinned lender program at the same address.
    f.svm
        .add_program(lender_harness::ID, &program("malicious_lender"))
        .unwrap();
    let before = f.snapshot(p);
    let err = f.settle(p, 100_000_000).unwrap_err();
    // The malicious lender did move the allowance; Bidwall's post-check reverted it.
    assert!(
        err.meta
            .logs
            .iter()
            .any(|l| l.contains("Instruction: TransferChecked")),
        "{err:?}"
    );
    custom(Err(err), 6007);
    assert_eq!(before, f.snapshot(p));
}

#[test]
fn escrow_cannot_be_spent_by_calling_the_lender_directly() {
    let mut f = Fixture::new();
    f.ready();
    let p = f.position(10_000_000, 900_000_000);
    let attacker = Keypair::new();
    f.svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();
    let loot = token_account(&mut f.svm, f.collateral, attacker.pubkey(), 0);
    let before = f.snapshot(p);
    let i = f.direct_liquidation(attacker.pubkey(), f.escrow, loot, p, 970_000_000, 0);
    // SPL Token rejects: the attacker is neither the escrow's owner nor its delegate.
    custom(send(&mut f.svm, &attacker, &[i], &[]), 4);
    assert_eq!(before, f.snapshot(p));
    // The liquidator PDA cannot be made to sign outside Bidwall.
    let mut i = f.direct_liquidation(
        pda(&[b"liquidator", f.bid.as_ref()]),
        f.escrow,
        loot,
        p,
        970_000_000,
        0,
    );
    i.accounts[0].is_signer = false;
    custom(send(&mut f.svm, &attacker, &[i], &[]), 3010);
    assert_eq!(before, f.snapshot(p));
}

#[test]
fn independent_liquidator_competes_and_bidwall_then_rejects_replay() {
    let mut f = Fixture::new();
    f.ready();
    let p = f.position(10_000_000, 900_000_000);
    let other = Keypair::new();
    f.svm.airdrop(&other.pubkey(), 1_000_000_000).unwrap();
    let usdc = token_account(&mut f.svm, f.usdc, other.pubkey(), 1_000_000_000);
    let out = token_account(&mut f.svm, f.collateral, other.pubkey(), 0);
    // Lender slippage bounds: underpaying the debt or demanding more collateral fails.
    for (payment, min) in [(899_999_999, 0), (900_000_000, 10_000_001)] {
        let i = f.direct_liquidation(other.pubkey(), usdc, out, p, payment, min);
        custom(send(&mut f.svm, &other, &[i], &[]), 6003);
    }
    let i = f.direct_liquidation(other.pubkey(), usdc, out, p, 900_000_000, 10_000_000);
    send(&mut f.svm, &other, &[i], &[]).unwrap();
    assert_eq!(amount(&f.svm, out), 10_000_000);
    assert_eq!(amount(&f.svm, f.lender.repay_supply), 900_000_000);
    let bid_before = f.svm.get_account(&f.bid).unwrap();
    custom(f.settle(p, 100_000_000), 6004);
    assert_eq!(bid_before, f.svm.get_account(&f.bid).unwrap());
    assert_eq!(amount(&f.svm, f.escrow), 9_700_000_000);
}

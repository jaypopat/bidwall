//! Bid lifecycle: funding, activation, time windows, withdrawal and terms.
use super::*;

#[test]
fn lifecycle_requires_full_funding_and_locks_funded_and_active_bids() {
    let mut f = Fixture::new();
    let i = ix(f.provider_accounts(), instruction::ActivateBid {});
    custom(send(&mut f.svm, &f.provider, &[i], &[]), 6001);
    f.fund();
    for active in [false, true] {
        if active {
            f.activate();
        }
        let i = ix(f.provider_accounts(), instruction::WithdrawBid {});
        custom(send(&mut f.svm, &f.provider, &[i], &[]), 6002);
        let i = ix(f.provider_accounts(), instruction::FundBid {});
        custom(send(&mut f.svm, &f.provider, &[i], &[]), 6001);
    }
}

#[test]
fn exact_start_and_expiry_boundaries() {
    let mut f = Fixture::new();
    f.fund();
    f.activate();
    let p = f.position(10_000_000, 900_000_000);
    time(&mut f.svm, 109);
    custom(f.settle(p, 100_000_000), 6002);
    time(&mut f.svm, 110);
    f.settle(p, 100_000_000).unwrap();
    let p = f.position(10_000_000, 900_000_000);
    time(&mut f.svm, 199);
    f.settle(p, 90_000_000).unwrap();
    let p = f.position(10_000_000, 900_000_000);
    time(&mut f.svm, 200);
    custom(f.settle(p, 80_000_000), 6002);
    let i = ix(f.provider_accounts(), instruction::WithdrawBid {});
    send(&mut f.svm, &f.provider, &[i], &[]).unwrap();
    assert_eq!(amount(&f.svm, f.provider_usdc), 18_060_000_000);
    assert_eq!(amount(&f.svm, f.escrow), 0);
    let i = ix(f.provider_accounts(), instruction::WithdrawBid {});
    custom(send(&mut f.svm, &f.provider, &[i], &[]), 6001);
}

#[test]
fn provider_cannot_reinitialize_or_withdraw_another_bid() {
    let mut f = Fixture::new();
    f.ready();
    let i = f.create_bid(1, 1, 0, 300);
    assert!(send(&mut f.svm, &f.provider, &[i], &[]).is_err());
    time(&mut f.svm, 200);
    let mut a = f.provider_accounts();
    a.provider = f.keeper.pubkey();
    let i = ix(a, instruction::WithdrawBid {});
    assert!(send(&mut f.svm, &f.keeper, &[i], &[]).is_err());
}

#[test]
fn insufficient_funding_leaves_draft_and_balances_unchanged() {
    let mut f = Fixture::new();
    let mut a = f.svm.get_account(&f.provider_usdc).unwrap();
    let mut t = SplAccount::unpack(&a.data).unwrap();
    t.amount = 9_699_999_999;
    SplAccount::pack(t, &mut a.data).unwrap();
    f.svm.set_account(f.provider_usdc, a).unwrap();
    let before = f.svm.get_account(&f.bid).unwrap();
    let i = ix(f.provider_accounts(), instruction::FundBid {});
    assert!(send(&mut f.svm, &f.provider, &[i], &[]).is_err());
    assert_eq!(before, f.svm.get_account(&f.bid).unwrap());
    assert_eq!(amount(&f.svm, f.provider_usdc), 9_699_999_999);
    assert_eq!(amount(&f.svm, f.escrow), 0);
}

#[test]
fn expired_draft_cannot_fund_and_expired_funded_bid_cannot_activate() {
    for funded in [false, true] {
        let mut f = Fixture::new();
        if funded {
            f.fund();
        }
        time(&mut f.svm, 200);
        let i = if funded {
            ix(f.provider_accounts(), instruction::ActivateBid {})
        } else {
            ix(f.provider_accounts(), instruction::FundBid {})
        };
        custom(send(&mut f.svm, &f.provider, &[i], &[]), 6002);
        let i = ix(f.provider_accounts(), instruction::WithdrawBid {});
        send(&mut f.svm, &f.provider, &[i], &[]).unwrap();
        assert_eq!(amount(&f.svm, f.provider_usdc), 20_000_000_000);
    }
}

#[test]
fn invalid_terms_rejected_without_creating_bid() {
    let mut f = Fixture::new();
    let id = 1u64;
    let bid = pda(&[b"bid", f.provider.pubkey().as_ref(), &id.to_le_bytes()]);
    let escrow = pda(&[b"escrow", bid.as_ref()]);
    for (price, quantity, start, expiry, code) in [
        (0, 100, 110, 200, 6000),
        (97, 0, 110, 200, 6000),
        (97, 100, 200, 200, 6000),
        (97, 100, 0, 100, 6000),
        (1, 1, 110, 200, 6000),
        (u64::MAX, u64::MAX, 110, 200, 6006),
    ] {
        let i = ix(
            accounts::CreateBid {
                provider: f.provider.pubkey(),
                market: f.market,
                usdc_mint: f.usdc,
                bid,
                escrow,
                token_program: token::ID,
                system_program: System::id(),
            },
            instruction::CreateBid {
                id,
                price,
                quantity,
                start,
                expiry,
            },
        );
        custom(send(&mut f.svm, &f.provider, &[i], &[]), code);
        assert!(f.svm.get_account(&bid).is_none());
    }
}

#[test]
fn arithmetic_bounds_and_fragmentation() {
    assert!(consideration(u64::MAX, u64::MAX, 1).is_err());
    assert!(consideration(1, 1, 0).is_err());
    assert_eq!(consideration(u64::MAX, 1, 1).unwrap(), u64::MAX);
    for price in [1, 97, 1_000_001, 97_000_000] {
        let mut paid = 0;
        for filled in 0..1000 {
            paid += consideration(filled + 1, price, 100).unwrap()
                - consideration(filled, price, 100).unwrap();
        }
        assert_eq!(paid, consideration(1000, price, 100).unwrap());
    }
}

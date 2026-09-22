//! Authorization and account substitution, including cross-market isolation.
use super::*;
use accounts::Settle;

#[test]
fn unauthorized_keeper_and_missing_signature_fail() {
    let mut f = Fixture::new();
    f.ready();
    let p = f.position(10_000_000, 900_000_000);
    let mut i = f.settlement(p, 100_000_000);
    i.accounts[0].pubkey = f.provider.pubkey();
    custom(send(&mut f.svm, &f.provider, &[i], &[]), 2001);
    let mut i = f.settlement(p, 100_000_000);
    i.accounts[0].is_signer = false;
    custom(send(&mut f.svm, &f.provider, &[i], &[]), 3010);
}

#[test]
fn substituted_accounts_and_programs_fail_without_side_effects() {
    let mut f = Fixture::new();
    f.ready();
    let p = f.position(10_000_000, 900_000_000);
    let wrong = mint(&mut f.svm, 6);
    let evil_usdc = token_account(&mut f.svm, f.usdc, f.keeper.pubkey(), 0);
    let evil_collateral = token_account(&mut f.svm, f.collateral, f.keeper.pubkey(), 0);
    let keeper = f.keeper.pubkey();
    let base = || f.settle_accounts(p);
    let l = f.lender;
    let cases = [
        (
            "usdc mint",
            2001,
            Settle {
                usdc_mint: wrong,
                ..base()
            },
        ),
        (
            "collateral mint",
            2001,
            Settle {
                collateral_mint: wrong,
                ..base()
            },
        ),
        (
            "escrow",
            2006,
            Settle {
                escrow: f.provider_usdc,
                ..base()
            },
        ),
        (
            "liquidator",
            2006,
            Settle {
                liquidator: keeper,
                ..base()
            },
        ),
        (
            "provider collateral",
            2003,
            Settle {
                provider_collateral: evil_collateral,
                ..base()
            },
        ),
        (
            "borrower usdc",
            2012,
            Settle {
                borrower_usdc: evil_usdc,
                ..base()
            },
        ),
        (
            "repay supply",
            2012,
            Settle {
                repay_supply: evil_usdc,
                ..base()
            },
        ),
        (
            "collateral supply",
            2012,
            Settle {
                collateral_supply: f.source,
                ..base()
            },
        ),
        (
            "market authority",
            2006,
            Settle {
                market_authority: keeper,
                ..base()
            },
        ),
        (
            "repay reserve",
            2012,
            Settle {
                repay_reserve: l.collateral_reserve,
                ..base()
            },
        ),
        (
            "collateral reserve",
            2012,
            Settle {
                collateral_reserve: l.repay_reserve,
                ..base()
            },
        ),
        (
            "token program",
            3008,
            Settle {
                token_program: System::id(),
                ..base()
            },
        ),
        (
            "lender program: token",
            3008,
            Settle {
                lender_program: token::ID,
                ..base()
            },
        ),
        (
            "lender program: bidwall",
            3008,
            Settle {
                lender_program: ID,
                ..base()
            },
        ),
        (
            "lender program: system",
            3008,
            Settle {
                lender_program: System::id(),
                ..base()
            },
        ),
    ];
    for (name, code, accounts) in cases {
        f.assert_rejected(name, p, accounts, code);
    }
    f.settle(p, 100_000_000).unwrap();
}

#[test]
fn market_isolation_and_lender_account_ownership() {
    let mut f = Fixture::new();
    f.ready();
    let p = f.position(10_000_000, 900_000_000);
    // A second genuine lender market with identical tokens, registered with the same keeper.
    let other = create_lender(&mut f.svm, &f.admin, f.collateral, f.usdc);
    let other_market = register(&mut f.svm, &f.admin, f.keeper.pubkey(), other.market);
    let foreign = f.position_in(other, 10_000_000, 900_000_000);
    let base = || f.settle_accounts(p);
    let other_lender = || Settle {
        lender_market: other.market,
        market_authority: other.authority,
        repay_reserve: other.repay_reserve,
        collateral_reserve: other.collateral_reserve,
        repay_supply: other.repay_supply,
        collateral_supply: other.collateral_supply,
        ..base()
    };
    let cases = [
        // The bid's Bidwall market pins a different lender market.
        ("other lender market", 2001, other_lender()),
        // The bid is allocated to exactly one Bidwall market.
        (
            "other bidwall market",
            2001,
            Settle {
                market: other_market,
                ..other_lender()
            },
        ),
        (
            "foreign position",
            6000,
            Settle {
                position: foreign,
                ..base()
            },
        ),
        (
            "foreign repay reserve",
            2012,
            Settle {
                repay_reserve: other.repay_reserve,
                ..base()
            },
        ),
        (
            "foreign supply",
            2012,
            Settle {
                collateral_supply: other.collateral_supply,
                ..base()
            },
        ),
    ];
    for (name, code, accounts) in cases {
        f.assert_rejected(name, p, accounts, code);
    }
    let mut a = f.svm.get_account(&p).unwrap();
    a.owner = System::id();
    f.svm.set_account(p, a).unwrap();
    custom(f.settle(p, 100_000_000), 3007);
}

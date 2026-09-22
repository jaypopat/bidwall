use super::*;
use anchor_lang::solana_program::{program_option::COption, program_pack::Pack};
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use anchor_spl::token::spl_token::state::{Account as SplAccount, AccountState, Mint as SplMint};
use litesvm::{types::FailedTransactionMetadata, LiteSVM};
use solana_sdk::{
    account::Account as SolAccount, clock::Clock, instruction::Instruction, pubkey::Pubkey,
    signature::Keypair, signer::Signer, transaction::Transaction,
};

fn ix(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    Instruction {
        program_id: ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    }
}
fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &ID).0
}
fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    instructions: &[Instruction],
    extras: &[&Keypair],
) -> std::result::Result<(), Box<FailedTransactionMetadata>> {
    svm.expire_blockhash();
    let mut signers = vec![payer];
    signers.extend_from_slice(extras);
    let tx = Transaction::new_signed_with_payer(
        instructions,
        Some(&payer.pubkey()),
        &signers,
        svm.latest_blockhash(),
    );
    svm.send_transaction(tx).map(|_| ()).map_err(Box::new)
}
fn mint(svm: &mut LiteSVM, decimals: u8) -> Pubkey {
    let key = Pubkey::new_unique();
    let mut data = vec![0; SplMint::LEN];
    SplMint::pack(
        SplMint {
            mint_authority: COption::None,
            supply: 1_000_000_000_000,
            decimals,
            is_initialized: true,
            freeze_authority: COption::None,
        },
        &mut data,
    )
    .unwrap();
    svm.set_account(
        key,
        SolAccount {
            lamports: 10_000_000,
            data,
            owner: token::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    key
}
fn token_account(svm: &mut LiteSVM, mint: Pubkey, owner: Pubkey, amount: u64) -> Pubkey {
    let key = Pubkey::new_unique();
    let mut data = vec![0; SplAccount::LEN];
    SplAccount::pack(
        SplAccount {
            mint,
            owner,
            amount,
            delegate: COption::None,
            state: AccountState::Initialized,
            is_native: COption::None,
            delegated_amount: 0,
            close_authority: COption::None,
        },
        &mut data,
    )
    .unwrap();
    svm.set_account(
        key,
        SolAccount {
            lamports: 10_000_000,
            data,
            owner: token::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    key
}
fn amount(svm: &LiteSVM, key: Pubkey) -> u64 {
    SplAccount::unpack(&svm.get_account(&key).unwrap().data)
        .unwrap()
        .amount
}
fn read<T: AccountDeserialize>(svm: &LiteSVM, key: Pubkey) -> T {
    T::try_deserialize(&mut svm.get_account(&key).unwrap().data.as_slice()).unwrap()
}
fn time(svm: &mut LiteSVM, timestamp: i64) {
    let mut c = svm.get_sysvar::<Clock>();
    c.unix_timestamp = timestamp;
    svm.set_sysvar(&c);
}
fn custom(result: std::result::Result<(), Box<FailedTransactionMetadata>>, code: u32) {
    let err = result.unwrap_err();
    assert!(
        format!("{:?}", err.err).contains(&format!("Custom({code})")),
        "{err:?}"
    );
}
struct Fixture {
    svm: LiteSVM,
    admin: Keypair,
    provider: Keypair,
    keeper: Keypair,
    market: Pubkey,
    usdc: Pubkey,
    collateral: Pubkey,
    source: Pubkey,
    provider_usdc: Pubkey,
    provider_collateral: Pubkey,
    borrower_usdc: Pubkey,
    borrower: Pubkey,
    bid: Pubkey,
    escrow: Pubkey,
    debt_vault: Pubkey,
}
impl Fixture {
    fn new() -> Self {
        Self::with_decimals(6)
    }
    fn with_decimals(decimals: u8) -> Self {
        let mut svm = LiteSVM::new();
        let path =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/bidwall.so");
        svm.add_program(
            ID,
            &std::fs::read(path).expect("Run anchor build before cargo test"),
        )
        .unwrap();
        let admin = Keypair::new();
        let provider = Keypair::new();
        let keeper = Keypair::new();
        for k in [&admin, &provider, &keeper] {
            svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
        }
        time(&mut svm, 100);
        let usdc = mint(&mut svm, 6);
        let collateral = mint(&mut svm, decimals);
        let market = Keypair::new();
        let debt_vault = pda(&[b"debt", market.pubkey().as_ref()]);
        let create = ix(
            accounts::CreateMarket {
                authority: admin.pubkey(),
                market: market.pubkey(),
                collateral_mint: collateral,
                usdc_mint: usdc,
                debt_vault,
                token_program: token::ID,
                system_program: System::id(),
            },
            instruction::CreateMarket {
                keeper: keeper.pubkey(),
                mark: 100_000_000,
            },
        );
        send(&mut svm, &admin, &[create], &[&market]).unwrap();
        let source = token_account(&mut svm, collateral, admin.pubkey(), 1_000_000_000);
        let provider_usdc = token_account(&mut svm, usdc, provider.pubkey(), 20_000_000_000);
        let provider_collateral = token_account(&mut svm, collateral, provider.pubkey(), 0);
        let borrower = Pubkey::new_unique();
        let borrower_usdc = token_account(&mut svm, usdc, borrower, 0);
        let bid = pda(&[b"bid", provider.pubkey().as_ref(), &0u64.to_le_bytes()]);
        let escrow = pda(&[b"escrow", bid.as_ref()]);
        let mut f = Self {
            svm,
            admin,
            provider,
            keeper,
            market: market.pubkey(),
            usdc,
            collateral,
            source,
            provider_usdc,
            provider_collateral,
            borrower_usdc,
            borrower,
            bid,
            escrow,
            debt_vault,
        };
        let create = f.create_bid(97_000_000, 100_000_000, 110, 200);
        send(&mut f.svm, &f.provider, &[create], &[]).unwrap();
        f
    }
    fn create_bid(&self, price: u64, quantity: u64, start: i64, expiry: i64) -> Instruction {
        ix(
            accounts::CreateBid {
                provider: self.provider.pubkey(),
                market: self.market,
                usdc_mint: self.usdc,
                bid: self.bid,
                escrow: self.escrow,
                token_program: token::ID,
                system_program: System::id(),
            },
            instruction::CreateBid {
                id: 0,
                price,
                quantity,
                start,
                expiry,
            },
        )
    }
    fn provider_accounts(&self) -> accounts::ProviderBid {
        accounts::ProviderBid {
            provider: self.provider.pubkey(),
            market: self.market,
            bid: self.bid,
            usdc_mint: self.usdc,
            escrow: self.escrow,
            provider_usdc: self.provider_usdc,
            token_program: token::ID,
        }
    }
    fn fund(&mut self) {
        let i = ix(self.provider_accounts(), instruction::FundBid {});
        send(&mut self.svm, &self.provider, &[i], &[]).unwrap();
    }
    fn activate(&mut self) {
        let i = ix(self.provider_accounts(), instruction::ActivateBid {});
        send(&mut self.svm, &self.provider, &[i], &[]).unwrap();
    }
    fn ready(&mut self) {
        self.fund();
        self.activate();
        time(&mut self.svm, 110);
    }
    fn position(&mut self, quantity: u64, debt: u64) -> Pubkey {
        let position = Keypair::new();
        let vault = pda(&[b"collateral", position.pubkey().as_ref()]);
        let i = ix(
            accounts::OpenPosition {
                authority: self.admin.pubkey(),
                market: self.market,
                borrower: self.borrower,
                position: position.pubkey(),
                collateral_mint: self.collateral,
                source: self.source,
                collateral_vault: vault,
                token_program: token::ID,
                system_program: System::id(),
            },
            instruction::OpenPosition { quantity, debt },
        );
        send(&mut self.svm, &self.admin, &[i], &[&position]).unwrap();
        position.pubkey()
    }
    fn settlement(&self, position: Pubkey, expected: u64) -> Instruction {
        ix(
            accounts::Settle {
                keeper: self.keeper.pubkey(),
                market: self.market,
                bid: self.bid,
                position,
                usdc_mint: self.usdc,
                collateral_mint: self.collateral,
                escrow: self.escrow,
                debt_vault: self.debt_vault,
                borrower_usdc: self.borrower_usdc,
                collateral_vault: pda(&[b"collateral", position.as_ref()]),
                provider_collateral: self.provider_collateral,
                token_program: token::ID,
            },
            instruction::Settle {
                expected_remaining: expected,
            },
        )
    }
    fn settle(
        &mut self,
        p: Pubkey,
        expected: u64,
    ) -> std::result::Result<(), Box<FailedTransactionMetadata>> {
        let i = self.settlement(p, expected);
        send(&mut self.svm, &self.keeper, &[i], &[])
    }
    fn snapshot(&self, position: Pubkey) -> Vec<SolAccount> {
        [
            self.bid,
            position,
            self.escrow,
            self.debt_vault,
            self.borrower_usdc,
            self.provider_collateral,
            pda(&[b"collateral", position.as_ref()]),
        ]
        .iter()
        .map(|k| self.svm.get_account(k).unwrap())
        .collect()
    }
}
#[test]
fn funded_partial_fill_depletion_and_residual_demo() {
    let mut f = Fixture::new();
    assert_eq!(amount(&f.svm, f.escrow), 0);
    f.ready();
    assert_eq!(amount(&f.svm, f.escrow), 9_700_000_000);
    let p = f.position(40_000_000, 3_600_000_000);
    f.settle(p, 100_000_000).unwrap();
    assert_eq!(amount(&f.svm, f.escrow), 5_820_000_000);
    assert_eq!(amount(&f.svm, f.debt_vault), 3_600_000_000);
    assert_eq!(amount(&f.svm, f.borrower_usdc), 280_000_000);
    assert_eq!(amount(&f.svm, f.provider_collateral), 40_000_000);
    let b: Bid = read(&f.svm, f.bid);
    assert_eq!(b.remaining_quantity, 60_000_000);
    assert_eq!(b.remaining_funds, 5_820_000_000);
    let position: Position = read(&f.svm, p);
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
fn substituted_mints_recipients_vaults_and_program_fail() {
    let mut f = Fixture::new();
    f.ready();
    let p = f.position(10_000_000, 900_000_000);
    let wrong = mint(&mut f.svm, 6);
    let evil_usdc = token_account(&mut f.svm, f.usdc, f.keeper.pubkey(), 0);
    let evil_collateral = token_account(&mut f.svm, f.collateral, f.keeper.pubkey(), 0);
    for (index, key) in [
        (4, wrong),
        (5, wrong),
        (6, f.provider_usdc),
        (7, f.provider_usdc),
        (8, evil_usdc),
        (9, f.source),
        (10, evil_collateral),
        (11, System::id()),
    ] {
        let before = f.snapshot(p);
        let mut i = f.settlement(p, 100_000_000);
        i.accounts[index].pubkey = key;
        assert!(
            send(&mut f.svm, &f.keeper, &[i], &[]).is_err(),
            "substitution {index}"
        );
        assert_eq!(before, f.snapshot(p));
    }
}
#[test]
fn delivery_failure_rolls_back_successful_payment_cpis() {
    let mut f = Fixture::new();
    f.ready();
    let p = f.position(10_000_000, 900_000_000);
    let mut acc = f.svm.get_account(&f.provider_collateral).unwrap();
    let mut tok = SplAccount::unpack(&acc.data).unwrap();
    tok.state = AccountState::Frozen;
    SplAccount::pack(tok, &mut acc.data).unwrap();
    f.svm.set_account(f.provider_collateral, acc).unwrap();
    let before = f.snapshot(p);
    let err = f.settle(p, 100_000_000).unwrap_err();
    let transfers = err
        .meta
        .logs
        .iter()
        .filter(|l| l.contains("Instruction: TransferChecked"))
        .count();
    assert_eq!(transfers, 3, "{err:?}");
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
fn failed_payment_preserves_debt_and_collateral() {
    let mut f = Fixture::new();
    f.ready();
    let p = f.position(10_000_000, 900_000_000);
    let mut a = f.svm.get_account(&f.debt_vault).unwrap();
    let mut t = SplAccount::unpack(&a.data).unwrap();
    t.state = AccountState::Frozen;
    SplAccount::pack(t, &mut a.data).unwrap();
    f.svm.set_account(f.debt_vault, a).unwrap();
    let before = f.snapshot(p);
    assert!(f.settle(p, 100_000_000).is_err());
    assert_eq!(before, f.snapshot(p));
}
#[test]
fn market_isolation_and_position_owner_checks() {
    let mut f = Fixture::new();
    f.ready();
    let p = f.position(10_000_000, 900_000_000);
    // Create a second genuine harness market with identical tokens and keeper.
    let other = Keypair::new();
    let debt_vault = pda(&[b"debt", other.pubkey().as_ref()]);
    let i = ix(
        accounts::CreateMarket {
            authority: f.admin.pubkey(),
            market: other.pubkey(),
            collateral_mint: f.collateral,
            usdc_mint: f.usdc,
            debt_vault,
            token_program: token::ID,
            system_program: System::id(),
        },
        instruction::CreateMarket {
            keeper: f.keeper.pubkey(),
            mark: 100_000_000,
        },
    );
    send(&mut f.svm, &f.admin, &[i], &[&other]).unwrap();
    let before = f.snapshot(p);
    let mut i = f.settlement(p, 100_000_000);
    i.accounts[1].pubkey = other.pubkey();
    i.accounts[7].pubkey = debt_vault;
    custom(send(&mut f.svm, &f.keeper, &[i], &[]), 2001);
    assert_eq!(before, f.snapshot(p));
    let mut a = f.svm.get_account(&p).unwrap();
    a.owner = System::id();
    f.svm.set_account(p, a).unwrap();
    custom(f.settle(p, 100_000_000), 3007);
}
#[test]
fn harness_mark_authority_and_liquidation_threshold() {
    let mut f = Fixture::new();
    f.ready();
    let p = f.position(10_000_000, 800_000_000);
    custom(f.settle(p, 100_000_000), 6005);
    let i = ix(
        accounts::SetMark {
            authority: f.provider.pubkey(),
            market: f.market,
        },
        instruction::SetMark { mark: 90_000_000 },
    );
    custom(send(&mut f.svm, &f.provider, &[i], &[]), 2001);
    let i = ix(
        accounts::SetMark {
            authority: f.admin.pubkey(),
            market: f.market,
        },
        instruction::SetMark { mark: 90_000_000 },
    );
    send(&mut f.svm, &f.admin, &[i], &[]).unwrap();
    f.settle(p, 100_000_000).unwrap();
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

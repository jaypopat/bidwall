//! LiteSVM fixture shared by all test modules. Tests run the compiled SBF programs.
use super::*;
use anchor_lang::solana_program::{program_option::COption, program_pack::Pack};
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use anchor_spl::token;
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
fn lix(accounts: impl ToAccountMetas, data: impl InstructionData) -> Instruction {
    Instruction {
        program_id: lender_harness::ID,
        accounts: accounts.to_account_metas(None),
        data: data.data(),
    }
}
fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &ID).0
}
fn lpda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &lender_harness::ID).0
}
fn program(name: &str) -> Vec<u8> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(format!("../../target/deploy/{name}.so"));
    std::fs::read(path).expect("Run anchor build before cargo test")
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
/// Accounts of one lender-harness market, all owned or derived by the lender program.
#[derive(Clone, Copy)]
struct Lender {
    market: Pubkey,
    authority: Pubkey,
    repay_reserve: Pubkey,
    collateral_reserve: Pubkey,
    repay_supply: Pubkey,
    collateral_supply: Pubkey,
}
fn create_lender(svm: &mut LiteSVM, admin: &Keypair, collateral: Pubkey, usdc: Pubkey) -> Lender {
    let market = Keypair::new();
    let m = market.pubkey();
    let repay_reserve = lpda(&[b"reserve", m.as_ref(), usdc.as_ref()]);
    let collateral_reserve = lpda(&[b"reserve", m.as_ref(), collateral.as_ref()]);
    let l = Lender {
        market: m,
        authority: lpda(&[b"authority", m.as_ref()]),
        repay_reserve,
        collateral_reserve,
        repay_supply: lpda(&[b"supply", repay_reserve.as_ref()]),
        collateral_supply: lpda(&[b"supply", collateral_reserve.as_ref()]),
    };
    let i = lix(
        lender_harness::accounts::CreateMarket {
            authority: admin.pubkey(),
            market: m,
            market_authority: l.authority,
            collateral_mint: collateral,
            usdc_mint: usdc,
            repay_reserve,
            collateral_reserve,
            repay_supply: l.repay_supply,
            collateral_supply: l.collateral_supply,
            token_program: token::ID,
            system_program: System::id(),
        },
        lender_harness::instruction::CreateMarket { mark: 100_000_000 },
    );
    send(svm, admin, &[i], &[&market]).unwrap();
    l
}
fn register(svm: &mut LiteSVM, admin: &Keypair, keeper: Pubkey, lender: Pubkey) -> Pubkey {
    let market = Keypair::new();
    let i = ix(
        accounts::CreateMarket {
            authority: admin.pubkey(),
            market: market.pubkey(),
            lender_market: lender,
            system_program: System::id(),
        },
        instruction::CreateMarket { keeper },
    );
    send(svm, admin, &[i], &[&market]).unwrap();
    market.pubkey()
}
struct Fixture {
    svm: LiteSVM,
    admin: Keypair,
    provider: Keypair,
    keeper: Keypair,
    market: Pubkey,
    lender: Lender,
    usdc: Pubkey,
    collateral: Pubkey,
    source: Pubkey,
    provider_usdc: Pubkey,
    provider_collateral: Pubkey,
    borrower_usdc: Pubkey,
    bid: Pubkey,
    escrow: Pubkey,
}
impl Fixture {
    fn new() -> Self {
        Self::with_decimals(6)
    }
    fn with_decimals(decimals: u8) -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program(ID, &program("bidwall")).unwrap();
        svm.add_program(lender_harness::ID, &program("lender_harness"))
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
        let lender = create_lender(&mut svm, &admin, collateral, usdc);
        let market = register(&mut svm, &admin, keeper.pubkey(), lender.market);
        let source = token_account(&mut svm, collateral, admin.pubkey(), 1_000_000_000);
        let provider_usdc = token_account(&mut svm, usdc, provider.pubkey(), 20_000_000_000);
        let provider_collateral = token_account(&mut svm, collateral, provider.pubkey(), 0);
        let borrower_usdc = token_account(&mut svm, usdc, Pubkey::new_unique(), 0);
        let bid = pda(&[b"bid", provider.pubkey().as_ref(), &0u64.to_le_bytes()]);
        let escrow = pda(&[b"escrow", bid.as_ref()]);
        let f = Self {
            svm,
            admin,
            provider,
            keeper,
            market,
            lender,
            usdc,
            collateral,
            source,
            provider_usdc,
            provider_collateral,
            borrower_usdc,
            bid,
            escrow,
        };
        let create = f.create_bid(97_000_000, 100_000_000, 110, 200);
        let mut f = f;
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
    fn position_in(&mut self, lender: Lender, quantity: u64, debt: u64) -> Pubkey {
        let position = Keypair::new();
        let i = lix(
            lender_harness::accounts::OpenPosition {
                authority: self.admin.pubkey(),
                market: lender.market,
                collateral_reserve: lender.collateral_reserve,
                position: position.pubkey(),
                collateral_mint: self.collateral,
                usdc_mint: self.usdc,
                borrower_usdc: self.borrower_usdc,
                source: self.source,
                collateral_supply: lender.collateral_supply,
                token_program: token::ID,
                system_program: System::id(),
            },
            lender_harness::instruction::OpenPosition { quantity, debt },
        );
        send(&mut self.svm, &self.admin, &[i], &[&position]).unwrap();
        position.pubkey()
    }
    fn position(&mut self, quantity: u64, debt: u64) -> Pubkey {
        self.position_in(self.lender, quantity, debt)
    }
    fn settle_accounts(&self, position: Pubkey) -> accounts::Settle {
        let l = self.lender;
        accounts::Settle {
            keeper: self.keeper.pubkey(),
            market: self.market,
            bid: self.bid,
            escrow: self.escrow,
            liquidator: pda(&[b"liquidator", self.bid.as_ref()]),
            provider_collateral: self.provider_collateral,
            usdc_mint: self.usdc,
            collateral_mint: self.collateral,
            lender_program: lender_harness::ID,
            lender_market: l.market,
            market_authority: l.authority,
            repay_reserve: l.repay_reserve,
            collateral_reserve: l.collateral_reserve,
            position,
            repay_supply: l.repay_supply,
            collateral_supply: l.collateral_supply,
            borrower_usdc: self.borrower_usdc,
            token_program: token::ID,
        }
    }
    fn settlement(&self, position: Pubkey, expected: u64) -> Instruction {
        ix(
            self.settle_accounts(position),
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
    /// Settles with `accounts` and asserts it fails with `code`, changing nothing.
    fn assert_rejected(&mut self, name: &str, p: Pubkey, accounts: accounts::Settle, code: u32) {
        let before = self.snapshot(p);
        let i = ix(
            accounts,
            instruction::Settle {
                expected_remaining: self.remaining(),
            },
        );
        let result = send(&mut self.svm, &self.keeper, &[i], &[]);
        let err = result.expect_err(name);
        assert!(
            format!("{:?}", err.err).contains(&format!("Custom({code})")),
            "{name}: {err:?}"
        );
        assert_eq!(before, self.snapshot(p), "{name}");
    }
    fn remaining(&self) -> u64 {
        read::<Bid>(&self.svm, self.bid).remaining_quantity
    }
    /// Every account whose state a settlement may change, on either side of the CPI.
    fn snapshot(&self, position: Pubkey) -> Vec<SolAccount> {
        [
            self.bid,
            position,
            self.escrow,
            self.lender.repay_supply,
            self.lender.collateral_supply,
            self.borrower_usdc,
            self.provider_collateral,
        ]
        .iter()
        .map(|k| self.svm.get_account(k).unwrap())
        .collect()
    }
    fn set_token_state(&mut self, key: Pubkey, state: AccountState) {
        let mut acc = self.svm.get_account(&key).unwrap();
        let mut tok = SplAccount::unpack(&acc.data).unwrap();
        tok.state = state;
        SplAccount::pack(tok, &mut acc.data).unwrap();
        self.svm.set_account(key, acc).unwrap();
    }
    fn direct_liquidation(
        &self,
        liquidator: Pubkey,
        source_usdc: Pubkey,
        destination: Pubkey,
        position: Pubkey,
        payment: u64,
        min_collateral: u64,
    ) -> Instruction {
        let l = self.lender;
        lix(
            lender_harness::accounts::Liquidate {
                liquidator,
                market: l.market,
                market_authority: l.authority,
                repay_reserve: l.repay_reserve,
                collateral_reserve: l.collateral_reserve,
                position,
                usdc_mint: self.usdc,
                collateral_mint: self.collateral,
                source_usdc,
                repay_supply: l.repay_supply,
                collateral_supply: l.collateral_supply,
                destination_collateral: destination,
                borrower_usdc: self.borrower_usdc,
                token_program: token::ID,
            },
            lender_harness::instruction::Liquidate {
                payment,
                min_collateral,
            },
        )
    }
}

mod lender_boundary;
mod lifecycle;
mod rollback;
mod settlement;
mod substitution;

mod kamino;

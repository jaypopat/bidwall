//! Offline replay of real Kamino + farms binaries, with captured mainnet state.
//! Only local Bidwall keeper authorization is rebound to an ephemeral test signer.
use super::*;
use anchor_lang::solana_program::instruction::AccountMeta;
use base64::{engine::general_purpose::STANDARD, Engine};
use flate2::read::GzDecoder;
use serde_json::Value;
use std::{io::Read, str::FromStr};

struct Fork {
    svm: LiteSVM,
    keeper: Keypair,
    instructions: Vec<Instruction>,
    tracked: Vec<Pubkey>,
}
fn pk(s: &str) -> Pubkey {
    Pubkey::from_str(s).unwrap()
}
fn bytes(v: &Value) -> Vec<u8> {
    STANDARD.decode(v.as_str().unwrap()).unwrap()
}
impl Fork {
    fn new() -> Self {
        let mut json = String::new();
        GzDecoder::new(&include_bytes!("../../fixtures/kamino.json.gz")[..])
            .read_to_string(&mut json)
            .unwrap();
        let v: Value = serde_json::from_str(&json).unwrap();
        let mut svm = LiteSVM::new();
        let mut tracked = Vec::new();
        for (key, a) in v["accounts"].as_object().unwrap() {
            if a["executable"].as_bool().unwrap() {
                continue;
            }
            let key = pk(key);
            tracked.push(key);
            svm.set_account(
                key,
                SolAccount {
                    lamports: a["lamports"].as_u64().unwrap(),
                    data: bytes(&a["data"]),
                    owner: pk(a["owner"].as_str().unwrap()),
                    executable: false,
                    rent_epoch: 0,
                },
            )
            .unwrap();
        }
        for (key, p) in v["programs"].as_object().unwrap() {
            svm.add_program(pk(key), &bytes(&p["elf"])).unwrap();
        }
        svm.add_program(ID, &program("bidwall")).unwrap();
        let c = bytes(&v["clock"]);
        svm.set_sysvar(&Clock {
            slot: u64::from_le_bytes(c[0..8].try_into().unwrap()),
            epoch_start_timestamp: i64::from_le_bytes(c[8..16].try_into().unwrap()),
            epoch: u64::from_le_bytes(c[16..24].try_into().unwrap()),
            leader_schedule_epoch: u64::from_le_bytes(c[24..32].try_into().unwrap()),
            unix_timestamp: i64::from_le_bytes(c[32..40].try_into().unwrap()),
        });
        let mut instructions: Vec<Instruction> = v["instructions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| Instruction {
                program_id: pk(i["program"].as_str().unwrap()),
                data: bytes(&i["data"]),
                accounts: i["accounts"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|a| AccountMeta {
                        pubkey: pk(a["key"].as_str().unwrap()),
                        is_signer: a["signer"].as_bool().unwrap(),
                        is_writable: a["writable"].as_bool().unwrap(),
                    })
                    .collect(),
            })
            .collect();
        let keeper = Keypair::new();
        svm.airdrop(&keeper.pubkey(), 10_000_000_000).unwrap();
        let settlement = instructions.last_mut().unwrap();
        settlement.accounts[0].pubkey = keeper.pubkey();
        let m = settlement.accounts[1].pubkey;
        let mut market = svm.get_account(&m).unwrap();
        market.data[40..72].copy_from_slice(keeper.pubkey().as_ref());
        svm.set_account(m, market).unwrap();
        Self {
            svm,
            keeper,
            instructions,
            tracked,
        }
    }
    fn key(&self, index: usize) -> Pubkey {
        self.instructions.last().unwrap().accounts[index].pubkey
    }
    fn token(&self, index: usize) -> u64 {
        u64::from_le_bytes(
            self.svm.get_account(&self.key(index)).unwrap().data[64..72]
                .try_into()
                .unwrap(),
        )
    }
    fn bid(&self) -> Bid {
        read(&self.svm, self.key(2))
    }
    fn edit(&mut self, index: usize, f: impl FnOnce(&mut SolAccount)) {
        let key = self.key(index);
        let mut a = self.svm.get_account(&key).unwrap();
        f(&mut a);
        self.svm.set_account(key, a).unwrap();
    }
    fn arg(&mut self, index: usize, value: u64) {
        self.instructions.last_mut().unwrap().data[8 + index * 8..16 + index * 8]
            .copy_from_slice(&value.to_le_bytes());
    }
    fn send(&mut self) -> std::result::Result<(), Box<FailedTransactionMetadata>> {
        let mut ix = vec![Instruction {
            program_id: pk("ComputeBudget111111111111111111111111111111"),
            accounts: vec![],
            data: [vec![2], 400_000u32.to_le_bytes().to_vec()].concat(),
        }];
        ix.extend(self.instructions.clone());
        send(&mut self.svm, &self.keeper, &ix, &[])
    }
    fn rejects(&mut self, code: u32) -> Box<FailedTransactionMetadata> {
        let before: Vec<_> = self
            .tracked
            .iter()
            .map(|k| (*k, self.svm.get_account(k)))
            .collect();
        let error = self.send().unwrap_err();
        assert!(
            format!("{:?}", error.err).contains(&format!("Custom({code})")),
            "{error:?}"
        );
        for (key, account) in before {
            assert_eq!(self.svm.get_account(&key), account, "rollback {key}");
        }
        error
    }
}
#[test]
fn real_kamino_pays_debt_delivers_collateral_and_borrower_surplus() {
    let mut f = Fork::new();
    let before = f.bid();
    let escrow = f.token(3);
    let repay = f.token(12);
    let provider = f.token(10);
    let borrower = f.token(11);
    f.send().unwrap();
    let after = f.bid();
    let delivered = f.token(10) - provider;
    let spent = f.token(12) - repay;
    assert!(spent > 0 && delivered > 0);
    let proceeds = consideration(delivered, before.price, 100_000_000).unwrap();
    assert!(proceeds > spent);
    assert_eq!(escrow - f.token(3), proceeds);
    assert_eq!(f.token(11) - borrower, proceeds - spent);
    assert_eq!(
        after.remaining_quantity,
        before.remaining_quantity - delivered
    );
    assert_eq!(after.remaining_funds, before.remaining_funds - proceeds);
    for index in [7, 8, 9] {
        assert_eq!(f.token(index), 0);
    }
    f.rejects(6004); // Newly signed replay with fresh blockhash also fails.
}
#[test]
fn kamino_unauthorized_keeper() {
    let mut f = Fork::new();
    f.edit(1, |a| {
        a.data[40..72].copy_from_slice(Pubkey::new_unique().as_ref())
    });
    f.rejects(2001);
}
#[test]
fn kamino_program_substitution() {
    let mut f = Fork::new();
    f.instructions.last_mut().unwrap().accounts[13].pubkey = token::ID;
    f.rejects(3008);
}
#[test]
fn kamino_wrong_market_and_reserves() {
    for index in [18, 20, 23] {
        let mut f = Fork::new();
        f.instructions.last_mut().unwrap().accounts[index].pubkey = f.key(if index == 18 {
            20
        } else if index == 20 {
            23
        } else {
            20
        });
        f.rejects(6000);
    }
}
#[test]
fn kamino_wrong_mints_and_recipients() {
    for index in [5, 6, 10, 11, 12] {
        let mut f = Fork::new();
        if index == 5 || index == 6 {
            f.instructions.last_mut().unwrap().accounts[index].pubkey =
                f.key(if index == 5 { 6 } else { 5 });
        } else {
            f.edit(index, |a| {
                a.data[..32].copy_from_slice(Pubkey::new_unique().as_ref())
            });
        }
        let result = f.send();
        assert!(result.is_err(), "index {index}");
    }
}
#[test]
fn kamino_rejects_stale_quote_and_budget() {
    for (arg, value, code) in [
        (0, u64::MAX, 6003),
        (1, 0, 6003),
        (2, 1, 6004),
        (3, 1, 6004),
    ] {
        let mut f = Fork::new();
        f.arg(arg, value);
        f.rejects(code);
    }
}
#[test]
fn kamino_overfill_rolls_back_after_actual_lender_cpi() {
    let mut f = Fork::new();
    f.edit(2, |a| a.data[128..136].copy_from_slice(&1u64.to_le_bytes()));
    f.arg(2, 1);
    let e = f.rejects(6003);
    assert!(e
        .meta
        .logs
        .iter()
        .any(|l| l.contains("Instruction: LiquidateObligationAndRedeemReserveCollateralV2")));
}
#[test]
fn kamino_insufficient_fixed_price_rolls_back() {
    let mut f = Fork::new();
    f.edit(2, |a| a.data[112..120].copy_from_slice(&1u64.to_le_bytes()));
    f.rejects(6003);
}
#[test]
fn kamino_frozen_delivery_rolls_back_lender_and_all_payments() {
    let mut f = Fork::new();
    f.edit(10, |a| a.data[108] = 2);
    let e = f.rejects(17);
    assert!(e
        .meta
        .logs
        .iter()
        .any(|l| l.contains("Program log: Instruction: TransferChecked")));
}
#[test]
fn kamino_wrong_borrower_owner_rejected() {
    let mut f = Fork::new();
    f.edit(11, |a| {
        a.data[32..64].copy_from_slice(Pubkey::new_unique().as_ref())
    });
    f.rejects(6000);
}
#[test]
fn kamino_expiry_and_inactive_bid() {
    for (offset, value, code) in [(152, u64::MAX, 6002), (160, 1, 6001)] {
        let mut f = Fork::new();
        f.edit(2, |a| {
            if offset == 160 {
                a.data[offset] = value as u8
            } else {
                a.data[offset..offset + 8].copy_from_slice(&value.to_le_bytes())
            }
        });
        f.rejects(code);
    }
}

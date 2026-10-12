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
/// One captured liquidation of a supported reserve pair, plus the facts tests need.
struct Spec {
    name: &'static str,
    fixture: &'static [u8],
    lending_market: &'static str,
    collateral_mint: &'static str,
    /// Raw collateral atoms per whole token: bid prices are USDC atoms per `scale`.
    scale: u64,
    /// Scope spot and TWAP entries for the collateral in the shared feed.
    scope_indices: [usize; 2],
    /// A price at which the captured loan is healthy: mantissa × 10^(exp − shift).
    healthy_price: (u64, u32),
}
const SCOPE_FEED: &str = "3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH";
const NVDAX: Spec = Spec {
    name: "NVDAx",
    fixture: include_bytes!("../../fixtures/kamino.json.gz"),
    lending_market: "5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua",
    collateral_mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    scale: 100_000_000,
    scope_indices: [332, 269],
    healthy_price: (225, 0),
};
const ONYC: Spec = Spec {
    name: "ONyc",
    fixture: include_bytes!("../../fixtures/kamino-onyc.json.gz"),
    lending_market: "47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8",
    collateral_mint: "5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5",
    scale: 1_000_000_000,
    scope_indices: [350, 478],
    healthy_price: (115, 2),
};
const SPECS: [&Spec; 2] = [&NVDAX, &ONYC];

impl Fork {
    fn new(spec: &Spec) -> Self {
        let mut json = String::new();
        GzDecoder::new(spec.fixture)
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
        let error = self.rejects_any();
        assert!(
            format!("{:?}", error.err).contains(&format!("Custom({code})")),
            "{error:?}"
        );
        error
    }
    fn rejects_any(&mut self) -> Box<FailedTransactionMetadata> {
        let before: Vec<_> = self
            .tracked
            .iter()
            .map(|k| (*k, self.svm.get_account(k)))
            .collect();
        let error = self.send().unwrap_err();
        for (key, account) in before {
            assert_eq!(self.svm.get_account(&key), account, "rollback {key}");
        }
        error
    }
}
#[test]
fn real_kamino_pays_debt_delivers_collateral_and_borrower_surplus() {
    for spec in SPECS {
        let mut f = Fork::new(spec);
        let before = f.bid();
        let escrow = f.token(3);
        let repay = f.token(12);
        let provider = f.token(10);
        let borrower = f.token(11);
        f.send().unwrap();
        let after = f.bid();
        let delivered = f.token(10) - provider;
        let spent = f.token(12) - repay;
        assert!(spent > 0 && delivered > 0, "{}", spec.name);
        let proceeds = consideration(delivered, before.price, spec.scale).unwrap();
        assert!(proceeds > spent, "{}", spec.name);
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
        f.arg(0, after.remaining_funds);
        f.arg(2, after.remaining_quantity);
        f.rejects(6004); // Correcting bid capacity cannot replay the old loan quote.
        let loan = f.svm.get_account(&f.key(17)).unwrap();
        f.arg(
            3,
            u64::from_le_bytes(loan.data[128..136].try_into().unwrap()),
        );
        f.send().unwrap(); // A genuinely fresh partial-liquidation quote is allowed.
    }
}
#[test]
fn kamino_market_registered_for_another_pair_is_rejected() {
    for (spec, other) in [(&NVDAX, &ONYC), (&ONYC, &NVDAX)] {
        let mut f = Fork::new(spec);
        // Market layout: discriminator, authority, keeper, lender_program, lender_market.
        f.edit(1, |a| {
            a.data[104..136].copy_from_slice(pk(other.lending_market).as_ref())
        });
        f.rejects(6000);
    }
}
#[test]
fn kamino_registration_follows_the_pair_table() {
    use anchor_spl::token_2022;
    for spec in SPECS {
        let mut f = Fork::new(spec);
        let usdc = pk("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
        let collateral = pk(spec.collateral_mint);
        let program = f.svm.get_account(&collateral).unwrap().owner;
        let wrong_program = if program == token::ID {
            token_2022::ID
        } else {
            token::ID
        };
        for (mint, token_program, ok) in [
            (usdc, token::ID, false),           // not a supported collateral mint
            (collateral, wrong_program, false), // mint under the wrong token program
            (collateral, program, true),
        ] {
            let market = Keypair::new();
            let keeper = f.keeper.insecure_clone();
            let result = send(
                &mut f.svm,
                &keeper,
                &[ix(
                    crate::accounts::CreateKaminoMarket {
                        authority: keeper.pubkey(),
                        market: market.pubkey(),
                        usdc_mint: usdc,
                        collateral_mint: mint,
                        collateral_token_program: token_program,
                        system_program: anchor_lang::system_program::ID,
                    },
                    crate::instruction::CreateKaminoMarket {
                        keeper: keeper.pubkey(),
                    },
                )],
                &[&market],
            );
            assert_eq!(result.is_ok(), ok, "{} {mint} {result:?}", spec.name);
            if ok {
                let m: Market = read(&f.svm, market.pubkey());
                assert_eq!(m.lender_market, pk(spec.lending_market));
                assert_eq!(m.collateral_mint, collateral);
                assert_eq!(m.scale, spec.scale);
            }
        }
    }
}
#[test]
fn kamino_unauthorized_keeper() {
    for spec in SPECS {
        let mut f = Fork::new(spec);
        f.edit(1, |a| {
            a.data[40..72].copy_from_slice(Pubkey::new_unique().as_ref())
        });
        f.rejects(2001);
    }
}
#[test]
fn kamino_program_substitution() {
    for spec in SPECS {
        let mut f = Fork::new(spec);
        f.instructions.last_mut().unwrap().accounts[13].pubkey = token::ID;
        f.rejects(3008);
    }
}
#[test]
fn kamino_wrong_market_and_reserves() {
    // 18: lending market, 20: USDC reserve, 23: collateral reserve.
    for spec in SPECS {
        for (index, substitute) in [(18, 20), (20, 23), (23, 20)] {
            let mut f = Fork::new(spec);
            f.instructions.last_mut().unwrap().accounts[index].pubkey = f.key(substitute);
            f.rejects(6000);
        }
    }
}
#[test]
fn kamino_wrong_mints_and_recipients() {
    for spec in SPECS {
        for index in [5, 6, 10, 11, 12] {
            let mut f = Fork::new(spec);
            if index == 5 || index == 6 {
                f.instructions.last_mut().unwrap().accounts[index].pubkey =
                    f.key(if index == 5 { 6 } else { 5 });
            } else {
                f.edit(index, |a| {
                    a.data[..32].copy_from_slice(Pubkey::new_unique().as_ref())
                });
            }
            f.rejects_any();
        }
    }
}
#[test]
fn kamino_rejects_stale_quote_and_budget() {
    for spec in SPECS {
        for (arg, value, code) in [
            (0, u64::MAX, 6003),
            (1, 0, 6003),
            (2, 1, 6004),
            (3, 1, 6004),
        ] {
            let mut f = Fork::new(spec);
            f.arg(arg, value);
            f.rejects(code);
        }
    }
}
fn lender_succeeded(e: &FailedTransactionMetadata) -> bool {
    e.meta
        .logs
        .iter()
        .any(|l| l == "Program KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD success")
}
#[test]
fn kamino_overfill_rolls_back_after_actual_lender_cpi() {
    for spec in SPECS {
        let mut f = Fork::new(spec);
        f.edit(2, |a| a.data[128..136].copy_from_slice(&1u64.to_le_bytes()));
        f.arg(2, 1);
        assert!(lender_succeeded(&f.rejects(6003)), "{}", spec.name);
    }
}
#[test]
fn kamino_insufficient_fixed_price_rolls_back() {
    for spec in SPECS {
        let mut f = Fork::new(spec);
        f.edit(2, |a| a.data[112..120].copy_from_slice(&1u64.to_le_bytes()));
        f.rejects(6003);
    }
}
#[test]
fn kamino_frozen_delivery_rolls_back_lender_and_all_payments() {
    for spec in SPECS {
        let mut f = Fork::new(spec);
        f.edit(10, |a| a.data[108] = 2);
        assert!(lender_succeeded(&f.rejects(17)), "{}", spec.name);
    }
}
#[test]
fn kamino_wrong_borrower_owner_rejected() {
    for spec in SPECS {
        let mut f = Fork::new(spec);
        f.edit(11, |a| {
            a.data[32..64].copy_from_slice(Pubkey::new_unique().as_ref())
        });
        f.rejects(6000);
    }
}
#[test]
fn kamino_expiry_and_inactive_bid() {
    for spec in SPECS {
        for (offset, value, code) in [(152, u64::MAX, 6002), (160, 1, 6001)] {
            let mut f = Fork::new(spec);
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
}

#[test]
fn kamino_native_healthy_loan_and_stale_oracle() {
    for spec in SPECS {
        for healthy in [true, false] {
            let mut f = Fork::new(spec);
            let key = pk(SCOPE_FEED);
            let mut a = f.svm.get_account(&key).unwrap();
            for index in spec.scope_indices {
                let offset = 40 + index * 56;
                if healthy {
                    let exp =
                        u64::from_le_bytes(a.data[offset + 8..offset + 16].try_into().unwrap());
                    let (mantissa, shift) = spec.healthy_price;
                    a.data[offset..offset + 8]
                        .copy_from_slice(&(mantissa * 10u64.pow(exp as u32 - shift)).to_le_bytes());
                } else {
                    a.data[offset + 24..offset + 32].fill(0);
                }
            }
            f.svm.set_account(key, a).unwrap();
            let e = f.rejects_any();
            assert!(
                e.meta.logs.iter().any(|l| l.contains(if healthy {
                    "ObligationHealthy"
                } else {
                    "PriceTooOld"
                })),
                "{} {e:?}",
                spec.name
            );
        }
    }
}
#[test]
fn kamino_native_refresh_required() {
    for spec in SPECS {
        let mut f = Fork::new(spec);
        f.instructions.drain(..3);
        let e = f.rejects_any();
        assert!(e.meta.logs.iter().any(|l| l.contains("Stale")), "{e:?}");
    }
}
#[test]
fn kamino_minimum_delivery_enforced_by_lender() {
    for spec in SPECS {
        let mut f = Fork::new(spec);
        f.arg(1, u64::MAX);
        let e = f.rejects(6066);
        assert!(
            e.meta
                .logs
                .iter()
                .any(|l| l.contains("LiquidationRewardTooSmall")),
            "{e:?}"
        );
    }
}
#[test]
fn kamino_obligation_owner_discriminator_and_length_are_checked() {
    for spec in SPECS {
        for change in 0..3 {
            let mut f = Fork::new(spec);
            f.edit(17, |a| match change {
                0 => a.owner = ID,
                1 => a.data[0] ^= 1,
                _ => a.data.truncate(2000),
            });
            // Native refresh may reject first; exercise the adapter parser directly.
            f.instructions.drain(..3);
            f.rejects(6000);
        }
    }
}
#[test]
fn kamino_exact_capacity_exhaustion() {
    for spec in SPECS {
        // The keeper must size repayment so seized collateral fits the bid: reuse the
        // repayment that delivered exactly `delivered` in an identical quote run.
        let mut quote = Fork::new(spec);
        let repay_before = quote.token(12);
        quote.send().unwrap();
        let delivered = quote.token(10);
        let repay = quote.token(12) - repay_before;
        let mut f = Fork::new(spec);
        let budget = consideration(delivered, f.bid().price, spec.scale).unwrap();
        f.edit(2, |a| {
            a.data[120..128].copy_from_slice(&delivered.to_le_bytes());
            a.data[128..136].copy_from_slice(&delivered.to_le_bytes());
            a.data[136..144].copy_from_slice(&budget.to_le_bytes());
        });
        f.edit(3, |a| a.data[64..72].copy_from_slice(&budget.to_le_bytes()));
        f.arg(0, repay);
        f.arg(2, delivered);
        f.send().unwrap();
        assert_eq!(f.bid().state, BidState::Exhausted);
        assert_eq!(f.bid().remaining_quantity, 0);
        assert_eq!(f.bid().remaining_funds, 0);
        assert_eq!(f.token(3), 0);
        f.rejects(6001);
    }
}
#[test]
fn kamino_borrower_payment_failure_rolls_back_completed_liquidation() {
    for spec in SPECS {
        let mut f = Fork::new(spec);
        f.edit(11, |a| a.data[108] = 2);
        assert!(lender_succeeded(&f.rejects(17)), "{}", spec.name);
    }
}

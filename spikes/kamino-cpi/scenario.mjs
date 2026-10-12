import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import BN from "bn.js";
import { gzipSync } from "node:zlib";
import * as kit from "@solana/kit";
import {
  Reserve,
  Obligation,
} from "@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/index.js";
import {
  refreshReserve,
  refreshObligation,
  liquidateObligationAndRedeemReserveCollateralV2,
} from "@kamino-finance/klend-sdk/dist/@codegen/klend/instructions/index.js";

import { OraclePrices } from "@kamino-finance/scope-sdk/dist/@codegen/scope/accounts/OraclePrices.js";
import { FARMS_PROGRAM_ADDRESS } from "@kamino-finance/farms-sdk";
import { rpc, account } from "./rpc.mjs";
import { fixtureManifest } from "../../scripts/kamino-fixture.mjs";
import { PAIR } from "./pairs.mjs";
const KLEND = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
  BIDWALL = "HQhMdM6YjEdrHzD6TGeDLrTCF491EiQntRRpA9Hs2g37";
const MARKET = PAIR.market,
  COLLATERAL = PAIR.collateralReserve,
  USDC = PAIR.usdcReserve;
const OBLIGATION = PAIR.obligation;
// NVDAx keeps its original evidence names; other pairs get their own files.
const suffix = PAIR.fixture === "kamino" ? "" : `-${PAIR.label.toLowerCase()}`;
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  ZERO = "11111111111111111111111111111111";
const encode = kit.getAddressEncoder(),
  decode = kit.getAddressDecoder();
const pda = async (program, seeds) =>
  (await kit.getProgramDerivedAddress({ programAddress: program, seeds }))[0];
const ata = (owner, mint, program) =>
  pda("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", [
    encode.encode(owner),
    encode.encode(program),
    encode.encode(mint),
  ]);
mkdirSync(new URL("./evidence/", import.meta.url), { recursive: true });
const evidence = {
  label: `Local mainnet fork (${PAIR.label}). Real Kamino binary and obligation; locally funded liquidator and stressed Scope price.`,
  observedAt: new Date().toISOString(),
  market: MARKET,
  obligation: OBLIGATION,
  changes: [],
  transactions: [],
};
const raw = {};
async function capture(key) {
  const a = await account(key);
  raw[key] = { ...a, data: a.data.toString("base64") };
  return a;
}
let reserveC = Reserve.decode((await capture(COLLATERAL)).data),
  reserveU = Reserve.decode((await capture(USDC)).data);
// Pin mutually dependent lender accounts from ONE upstream RPC context. Lazy reads
// across different slots can produce vault/reserve accounting mismatches.
const farmUser = await pda(FARMS_PROGRAM_ADDRESS, [
  Buffer.from("user"),
  encode.encode(reserveU.farmDebt),
  encode.encode(OBLIGATION),
]);
const keys = [
  ...new Set([
    MARKET,
    COLLATERAL,
    USDC,
    OBLIGATION,
    farmUser,
    reserveU.farmDebt,
    reserveC.config.tokenInfo.scopeConfiguration.priceFeed,
    ...[reserveC, reserveU].flatMap((r) => [
      r.liquidity.mintPubkey,
      r.liquidity.supplyVault,
      r.liquidity.feeVault,
      r.collateral.mintPubkey,
      r.collateral.supplyVault,
    ]),
  ]),
];
const remote = await fetch("https://api.mainnet-beta.solana.com", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "getMultipleAccounts",
    params: [keys, { encoding: "base64", commitment: "confirmed" }],
  }),
});
const batch = await remote.json();
if (batch.error) throw new Error(JSON.stringify(batch.error));
evidence.coherentSnapshotSlot = batch.result.context.slot;
for (let i = 0; i < keys.length; i++) {
  const a = batch.result.value[i];
  assert(a, keys[i]);
  await rpc("surfnet_setAccount", [
    keys[i],
    {
      lamports: a.lamports,
      owner: a.owner,
      executable: a.executable,
      data: Buffer.from(a.data[0], "base64").toString("hex"),
    },
  ]);
}
const forkSlot =
  Math.max(
    batch.result.context.slot,
    (await rpc("getEpochInfo")).absoluteSlot
  ) + 1;
await rpc("surfnet_timeTravel", [{ absoluteSlot: forkSlot }]);
// Surfpool 1.3.0 reports absoluteSlot but writes slotIndex into Clock on timeTravel.
// Restore the absolute slot so LUT activation and lender refresh checks agree.
const fixedClock = await account("SysvarC1ock11111111111111111111111111111111");
fixedClock.data.writeBigUInt64LE(BigInt(forkSlot), 0);
await rpc("surfnet_setAccount", [
  "SysvarC1ock11111111111111111111111111111111",
  { data: fixedClock.data.toString("hex") },
]);
reserveC = Reserve.decode((await capture(COLLATERAL)).data);
reserveU = Reserve.decode((await capture(USDC)).data);
const obligation = Obligation.decode((await capture(OBLIGATION)).data);
assert.equal(obligation.lendingMarket, MARKET);
assert.equal(obligation.referrer, ZERO);
assert.equal(
  obligation.deposits.filter((x) => x.depositReserve !== ZERO).length,
  1
);
assert.equal(
  obligation.borrows.filter((x) => x.borrowReserve !== ZERO).length,
  1
);
assert.equal(obligation.deposits[0].depositReserve, COLLATERAL);
assert.equal(obligation.borrows[0].borrowReserve, USDC);
assert.equal(reserveC.farmCollateral, ZERO);
const program = await capture(KLEND);
assert.equal(program.executable, true);
const pd = decode.decode(program.data.subarray(4, 36));
const programData = await capture(pd);
evidence.program = {
  address: KLEND,
  programData: pd,
  sha256: createHash("sha256").update(programData.data).digest("hex"),
};
for (const mint of [
  reserveC.liquidity.mintPubkey,
  reserveU.liquidity.mintPubkey,
]) {
  const a = await capture(mint);
  evidence[mint] = {
    owner: a.owner,
    decimals: a.data[44],
    length: a.data.length,
  };
}
const payer = await kit.generateKeyPairSigner();
await rpc("surfnet_setAccount", [
  payer.address,
  { lamports: 10_000_000_000, owner: ZERO },
]);
const binary = readFileSync(
  new URL("../../anchor/target/deploy/bidwall.so", import.meta.url)
);
await rpc("surfnet_setAccount", [
  BIDWALL,
  {
    lamports: 10_000_000_000,
    data: binary.toString("hex"),
    owner: "BPFLoader2111111111111111111111111111111111",
    executable: true,
  },
]);
const marketSigner = await kit.generateKeyPairSigner();
const bidId = 1n;
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const bid = await pda(BIDWALL, [
  Buffer.from("bid"),
  encode.encode(payer.address),
  u64(bidId),
]);
const escrow = await pda(BIDWALL, [Buffer.from("escrow"), encode.encode(bid)]);
const liquidator = await pda(BIDWALL, [
  Buffer.from("kamino_liquidator"),
  encode.encode(bid),
]);
const idl = JSON.parse(
  readFileSync(new URL("../../anchor/target/idl/bidwall.json", import.meta.url))
);
function instruction(name, accounts, args = []) {
  const spec = idl.instructions.find((i) => i.name === name);
  assert(spec, name);
  return {
    programAddress: BIDWALL,
    data: Buffer.concat([Buffer.from(spec.discriminator), ...args]),
    accounts: spec.accounts.map((a) => {
      const value = accounts[a.name];
      assert(value, a.name);
      return {
        address: value.address ?? value,
        role: (a.writable ? 1 : 0) + (a.signer ? 2 : 0),
        ...(a.signer ? { signer: value } : {}),
      };
    }),
  };
}
for (const [mint, program, amount] of [
  [reserveU.liquidity.mintPubkey, TOKEN, 0],
  [reserveC.collateral.mintPubkey, TOKEN, 0],
  [reserveC.liquidity.mintPubkey, reserveC.liquidity.tokenProgram, 0],
]) {
  await rpc("surfnet_setTokenAccount", [liquidator, mint, { amount }, program]);
}
const source = await ata(liquidator, reserveU.liquidity.mintPubkey, TOKEN),
  ctoken = await ata(liquidator, reserveC.collateral.mintPubkey, TOKEN),
  destination = await ata(
    liquidator,
    reserveC.liquidity.mintPubkey,
    reserveC.liquidity.tokenProgram
  );
const authority = await pda(KLEND, [Buffer.from("lma"), encode.encode(MARKET)]);
const debtFarm = await pda(FARMS_PROGRAM_ADDRESS, [
  Buffer.from("user"),
  encode.encode(reserveU.farmDebt),
  encode.encode(OBLIGATION),
]);
await capture(debtFarm);
const scope = reserveC.config.tokenInfo.scopeConfiguration.priceFeed;
assert.equal(scope, reserveU.config.tokenInfo.scopeConfiguration.priceFeed);
const oracle = await capture(scope),
  prices = OraclePrices.layout.decode(oracle.data.subarray(8));
await rpc("surfnet_pauseClock");
const clock = await account("SysvarC1ock11111111111111111111111111111111");
const slot = clock.data.readBigUInt64LE(0),
  timestamp = clock.data.readBigInt64LE(32);
evidence.slot = slot.toString();
evidence.timestamp = timestamp.toString();
// Update only this fork's Scope timestamps, then stress collateral spot/TWAP from the same feed.
for (const index of PAIR.freshIndices) {
  const price = prices.prices[index];
  evidence.changes.push({
    account: scope,
    index,
    before: {
      value: price.price.value.toString(),
      exp: price.price.exp.toString(),
      timestamp: price.unixTimestamp.toString(),
    },
  });
  price.unixTimestamp = new BN(timestamp.toString());
  price.lastUpdatedSlot = new BN(slot.toString());
}
async function setPrice(stress) {
  for (const index of PAIR.stressedIndices) {
    const original = evidence.changes.find((x) => x.index === index).before;
    prices.prices[index].price.value = stress
      ? PAIR.stressPrice(prices.prices[index].price.exp)
      : new BN(original.value);
  }
  const data = Buffer.from(oracle.data);
  OraclePrices.layout.encode(prices, data, 8);
  await rpc("surfnet_setAccount", [scope, { data: data.toString("hex") }]);
}
const refresh = [USDC, COLLATERAL].map((reserve) =>
  refreshReserve({
    reserve,
    lendingMarket: MARKET,
    pythOracle: kit.none(),
    switchboardPriceOracle: kit.none(),
    switchboardTwapOracle: kit.none(),
    scopePrices: kit.some(scope),
  })
);
refresh.push(
  refreshObligation({ lendingMarket: MARKET, obligation: OBLIGATION }, [
    { address: COLLATERAL, role: 1 },
    { address: USDC, role: 1 },
  ])
);
const l = liquidateObligationAndRedeemReserveCollateralV2(
  {
    liquidityAmount: new BN("1000000000"),
    minAcceptableReceivedLiquidityAmount: new BN("1"),
    maxAllowedLtvOverridePercent: new BN(0),
  },
  {
    liquidationAccounts: {
      liquidator: { address: liquidator },
      obligation: OBLIGATION,
      lendingMarket: MARKET,
      lendingMarketAuthority: authority,
      repayReserve: USDC,
      repayReserveLiquidityMint: reserveU.liquidity.mintPubkey,
      repayReserveLiquiditySupply: reserveU.liquidity.supplyVault,
      withdrawReserve: COLLATERAL,
      withdrawReserveLiquidityMint: reserveC.liquidity.mintPubkey,
      withdrawReserveCollateralMint: reserveC.collateral.mintPubkey,
      withdrawReserveCollateralSupply: reserveC.collateral.supplyVault,
      withdrawReserveLiquiditySupply: reserveC.liquidity.supplyVault,
      withdrawReserveLiquidityFeeReceiver: reserveC.liquidity.feeVault,
      userSourceLiquidity: source,
      userDestinationCollateral: ctoken,
      userDestinationLiquidity: destination,
      collateralTokenProgram: TOKEN,
      repayLiquidityTokenProgram: TOKEN,
      withdrawLiquidityTokenProgram: reserveC.liquidity.tokenProgram,
      instructionSysvarAccount: "Sysvar1nstructions1111111111111111111111111",
    },
    collateralFarmsAccounts: {
      obligationFarmUserState: kit.none(),
      reserveFarmState: kit.none(),
    },
    debtFarmsAccounts: {
      obligationFarmUserState: kit.some(debtFarm),
      reserveFarmState: kit.some(reserveU.farmDebt),
    },
    farmsProgram: FARMS_PROGRAM_ADDRESS,
  },
  [{ address: COLLATERAL, role: 1 }]
);
const { quantity, price, scale } = PAIR;
const providerUsdc = await ata(
  payer.address,
  reserveU.liquidity.mintPubkey,
  TOKEN
);
const providerCollateral = await ata(
  payer.address,
  reserveC.liquidity.mintPubkey,
  reserveC.liquidity.tokenProgram
);
const borrowerUsdc = await ata(
  obligation.owner,
  reserveU.liquidity.mintPubkey,
  TOKEN
);
for (const [owner, mint, program, amount] of [
  [payer.address, reserveU.liquidity.mintPubkey, TOKEN, 10_000_000_000],
  [
    payer.address,
    reserveC.liquidity.mintPubkey,
    reserveC.liquidity.tokenProgram,
    0,
  ],
  [obligation.owner, reserveU.liquidity.mintPubkey, TOKEN, 0],
])
  await rpc("surfnet_setTokenAccount", [owner, mint, { amount }, program]);
const base = {
  provider: payer,
  keeper: payer,
  authority: payer,
  market: marketSigner,
  bid,
  escrow,
  usdc_mint: reserveU.liquidity.mintPubkey,
  collateral_mint: reserveC.liquidity.mintPubkey,
  collateral_token_program: reserveC.liquidity.tokenProgram,
  token_program: TOKEN,
  system_program: ZERO,
  provider_usdc: providerUsdc,
  liquidator,
  source_usdc: source,
  destination_ctoken: ctoken,
  destination_collateral: destination,
  provider_collateral: providerCollateral,
  borrower_usdc: borrowerUsdc,
  repay_supply: reserveU.liquidity.supplyVault,
  lender_program: KLEND,
};
function settlement(overrides = {}, args = {}) {
  const ix = instruction("settle_kamino", { ...base, ...overrides }, [
    u64(args.maxRepay ?? 1_000_000_000n),
    u64(args.minimum ?? 1n),
    u64(args.remaining ?? quantity),
    u64(args.deposit ?? obligation.deposits[0].depositedAmount.toString()),
  ]);
  ix.accounts.push(
    ...l.accounts.map((a) => ({
      address: a.address,
      role: a.address === liquidator ? 0 : a.role,
    }))
  );
  return ix;
}
const settle = settlement();
const lutAddress = PAIR.lookupTable;
const lut = await capture(lutAddress),
  addresses = [];
for (let i = 56; i < lut.data.length; i += 32)
  addresses.push(decode.decode(lut.data.subarray(i, i + 32)));
async function transaction(label, instructions, expectedError = null) {
  const { value: blockhash } = await rpc("getLatestBlockhash");
  const budget = {
    programAddress: "ComputeBudget111111111111111111111111111111",
    accounts: [],
    data: Buffer.from([2, 128, 26, 6, 0]),
  }; // 400,000 CU
  const message = kit.pipe(
    kit.createTransactionMessage({ version: 0 }),
    (m) => kit.setTransactionMessageFeePayerSigner(payer, m),
    (m) =>
      kit.setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: blockhash.blockhash,
          lastValidBlockHeight: BigInt(blockhash.lastValidBlockHeight),
        },
        m
      ),
    (m) =>
      kit.appendTransactionMessageInstructions([budget, ...instructions], m),
    (m) =>
      kit.compressTransactionMessageUsingAddressLookupTables(m, {
        [lutAddress]: addresses,
      })
  );
  const tx = await kit.signTransactionMessageWithSigners(message),
    wire = kit.getBase64EncodedWireTransaction(tx);
  assert(Buffer.from(wire, "base64").length <= 1232, "v0 packet size");
  const simulated = await rpc("simulateTransaction", [
    wire,
    { encoding: "base64", sigVerify: true },
  ]);
  evidence.transactions.push({ label, simulation: simulated.value });
  writeFileSync(
    new URL(`./evidence/result${suffix}.json`, import.meta.url),
    JSON.stringify(evidence, null, 2)
  );
  console.log(
    label,
    JSON.stringify(simulated.value.err),
    simulated.value.logs?.slice(-10)
  );
  if (expectedError !== null) {
    assert.deepEqual(simulated.value.err, expectedError);
    return simulated.value;
  }
  assert.equal(simulated.value.err, null);
  const signature = await rpc("sendTransaction", [
    wire,
    { encoding: "base64", skipPreflight: false },
  ]);
  await rpc("surfnet_resumeClock");
  let status;
  for (let attempt = 0; attempt < 30; attempt++) {
    const statuses = await rpc("getSignatureStatuses", [[signature]]);
    status = statuses.value[0];
    if (status) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert(status, "Local transaction did not confirm");
  assert.equal(status.err, null);
  console.log("signature", signature);
  evidence.transactions.at(-1).signature = signature;
  await rpc("surfnet_pauseClock");
  return simulated.value;
}
await transaction("create funded active Bidwall bid", [
  instruction("create_kamino_market", base, [
    Buffer.from(encode.encode(payer.address)),
  ]),
  instruction("create_bid", base, [
    u64(bidId),
    u64(price),
    u64(quantity),
    u64(timestamp - 1n),
    u64(timestamp + 3600n),
  ]),
  instruction("fund_bid", base),
  instruction("activate_bid", base),
]);
await setPrice(false);
await transaction(
  "healthy obligation rejects liquidation",
  [...refresh, settle],
  { InstructionError: [4, { Custom: 6016 }] }
);
await setPrice(true);
const beforeSource = (await account(escrow)).data.readBigUInt64LE(64),
  beforeDest = (await account(providerCollateral)).data.readBigUInt64LE(64),
  beforeRepay = (
    await account(reserveU.liquidity.supplyVault)
  ).data.readBigUInt64LE(64),
  beforeBorrower = (await account(borrowerUsdc)).data.readBigUInt64LE(64);
await transaction(
  `stressed ${PAIR.stressLabel} CPI liquidation`,
  [...refresh, settle],
  null
);
const afterSource = (await account(escrow)).data.readBigUInt64LE(64),
  afterDest = (await account(providerCollateral)).data.readBigUInt64LE(64);
assert(afterSource < beforeSource);
assert(afterDest > beforeDest);
const delivered = afterDest - beforeDest;
const paid = beforeSource - afterSource;
const repaid =
  (await account(reserveU.liquidity.supplyVault)).data.readBigUInt64LE(64) -
  beforeRepay;
const residual =
  (await account(borrowerUsdc)).data.readBigUInt64LE(64) - beforeBorrower;
assert.equal(paid, (delivered * price) / scale);
assert.equal(paid, repaid + residual);
assert(repaid > 0n && residual > 0n);
const bidAfter = (await account(bid)).data;
assert.equal(bidAfter.readBigUInt64LE(128), quantity - delivered);
assert.equal(bidAfter.readBigUInt64LE(136), (quantity * price) / scale - paid);
for (const key of [source, ctoken, destination])
  assert.equal((await account(key)).data.readBigUInt64LE(64), 0n);
evidence.deltas = {
  bidConsideration: paid.toString(),
  debtRepaid: repaid.toString(),
  borrowerSurplus: residual.toString(),
  collateralReceived: (afterDest - beforeDest).toString(),
  obligationAfter: Obligation.decode((await account(OBLIGATION)).data).toJSON(),
};
writeFileSync(
  new URL(`./evidence/result${suffix}.json`, import.meta.url),
  JSON.stringify(evidence, null, 2)
);
writeFileSync(
  new URL(`./evidence/observations${suffix}.json`, import.meta.url),
  JSON.stringify(raw, null, 2)
);
console.log(
  evidence.deltas.bidConsideration,
  evidence.deltas.collateralReceived
);

// Explicit opt-in refresh of the committed offline replay fixture.
if (process.env.CAPTURE_FIXTURE === "1") {
  const signature = evidence.transactions.at(-1).signature;
  const snapshot = await rpc("surfnet_exportSnapshot", [
    { scope: { preTransaction: signature } },
  ]);
  const programs = {};
  // Classic SPL Token is built into the offline runtime; capture only deployed upgradeables.
  for (const key of [
    KLEND,
    FARMS_PROGRAM_ADDRESS,
    ...(reserveC.liquidity.tokenProgram === TOKEN
      ? []
      : [reserveC.liquidity.tokenProgram]),
  ]) {
    const p = await account(key);
    assert(p.executable);
    assert.equal(p.owner, "BPFLoaderUpgradeab1e11111111111111111111111");
    const pd = await account(decode.decode(p.data.subarray(4, 36)));
    const elf = pd.data.subarray(45);
    programs[key] = {
      elf: elf.toString("base64"),
      sha256: createHash("sha256").update(elf).digest("hex"),
    };
  }
  const fixture = {
    provenance: evidence,
    accounts: snapshot.value,
    programs,
    clock: (
      await account("SysvarC1ock11111111111111111111111111111111")
    ).data.toString("base64"),
    instructions: [...refresh, settle].map((ix) => ({
      program: ix.programAddress,
      data: Buffer.from(ix.data).toString("base64"),
      accounts: ix.accounts.map((a) => ({
        key: a.address,
        writable: (a.role & 1) !== 0,
        signer: (a.role & 2) !== 0,
      })),
    })),
  };
  const directory = new URL(
    "../../anchor/programs/bidwall/fixtures/",
    import.meta.url
  );
  mkdirSync(directory, { recursive: true });
  const fixtureBytes = gzipSync(JSON.stringify(fixture));
  const manifest = fixtureManifest(fixtureBytes);
  writeFileSync(new URL(`${PAIR.fixture}.json.gz`, directory), fixtureBytes);
  writeFileSync(
    new URL(
      PAIR.fixture === "kamino"
        ? "manifest.json"
        : `manifest-${PAIR.label.toLowerCase()}.json`,
      directory
    ),
    JSON.stringify(manifest, null, 2) + "\n"
  );
}

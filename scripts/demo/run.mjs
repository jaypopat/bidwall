import assert from "node:assert/strict";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import * as kit from "@solana/kit";
import {
  getCreateLookupTableInstructionAsync,
  getExtendLookupTableInstruction,
} from "@solana-program/address-lookup-table";
import { startRuntime, transactionRunner } from "./runtime.mjs";
const require = createRequire(import.meta.url);
const client = require("../../build/client/app/lib/bidwall/client.js");
const generated = require("../../build/client/app/generated/bidwall/index.js");
const fixtureBytes = readFileSync(
  "anchor/programs/bidwall/fixtures/kamino.json.gz"
);
const fixture = JSON.parse(gunzipSync(fixtureBytes));
const manifest = JSON.parse(
  readFileSync("anchor/programs/bidwall/fixtures/manifest.json")
);
assert.equal(
  createHash("sha256").update(fixtureBytes).digest("hex"),
  manifest.fixtureSha256,
  "Fixture/manifest mismatch"
);
const runtime = await startRuntime();
const { rpc, account } = runtime;
const report = {
  environment: "local offline replay",
  startedAt: new Date().toISOString(),
  rpc: runtime.url,
  fixtureSha256: manifest.fixtureSha256,
  upstreamSlot: manifest.coherentSnapshotSlot,
  status: "running",
  stages: [],
  transactions: [],
  seedOverrides: [
    "Captured Kamino/Scope state and deployed binaries",
    "Local test SOL and provider USDC",
    "Scenario clock and oracle price changes",
  ],
  programs: manifest.programElfSha256,
};
const save = () => {
  writeFileSync(
    "build/demo/receipt.json.tmp",
    JSON.stringify(
      report,
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2
    ) + "\n"
  );
  renameSync("build/demo/receipt.json.tmp", "build/demo/receipt.json");
};
const markStage = (id, mode) => {
  report.stages.push({ id, mode });
  save();
};
try {
  save();
  await rpc("surfnet_pauseClock");
  const recorded = fixture.instructions.at(-1).accounts;
  const skip = new Set([3, 7, 8, 9, 10, 11].map((i) => recorded[i].key));
  for (const [key, a] of Object.entries(fixture.accounts)) {
    if (
      a.executable ||
      a.owner === generated.BIDWALL_PROGRAM_ADDRESS ||
      skip.has(key)
    )
      continue;
    await rpc("surfnet_setAccount", [
      key,
      {
        lamports: a.lamports,
        owner: a.owner,
        data: Buffer.from(a.data, "base64").toString("hex"),
      },
    ]);
  }
  for (const [key, p] of Object.entries(fixture.programs)) {
    const elf = Buffer.from(p.elf, "base64");
    assert.equal(
      createHash("sha256").update(elf).digest("hex"),
      manifest.programElfSha256[key]
    );
    if (elf.length <= 2_000_000)
      await rpc("surfnet_setAccount", [
        key,
        {
          lamports: 10_000_000_000,
          owner: "BPFLoader2111111111111111111111111111111111",
          executable: true,
          data: elf.toString("hex"),
        },
      ]);
    else
      for (let offset = 0; offset < elf.length; offset += 1_000_000)
        await rpc("surfnet_writeProgram", [
          key,
          elf.subarray(offset, offset + 1_000_000).toString("hex"),
          offset,
        ]);
  }
  const bidwall = readFileSync("anchor/target/deploy/bidwall.so");
  report.bidwallSha256 = createHash("sha256").update(bidwall).digest("hex");
  await rpc("surfnet_setAccount", [
    generated.BIDWALL_PROGRAM_ADDRESS,
    {
      lamports: 10_000_000_000,
      owner: "BPFLoader2111111111111111111111111111111111",
      executable: true,
      data: bidwall.toString("hex"),
    },
  ]);
  const clock = Buffer.from(fixture.clock, "base64");
  await rpc("surfnet_timeTravel", [
    { absoluteSlot: Number(clock.readBigUInt64LE(0)) },
  ]);
  await rpc("surfnet_setAccount", [
    "SysvarC1ock11111111111111111111111111111111",
    { data: clock.toString("hex") },
  ]);
  const now = clock.readBigInt64LE(32);
  const payer = await kit.generateKeyPairSigner(),
    market = await kit.generateKeyPairSigner();
  await rpc("surfnet_setAccount", [
    payer.address,
    { lamports: 10_000_000_000, owner: "11111111111111111111111111111111" },
  ]);
  await rpc("surfnet_setTokenAccount", [
    payer.address,
    client.KAMINO.usdcMint,
    { amount: 10_000_000_000 },
    client.KAMINO.tokenProgram,
  ]);
  const { transact, setLookupTables } = transactionRunner(
    runtime,
    payer,
    report.transactions
  );
  const plan = await client.prepareBid({
    provider: payer,
    market: market.address,
    id: 1n,
    price: 150_000_000n,
    quantity: 1_000_000_000n,
    start: now - 1n,
    expiry: now + 3600n,
    now,
  });
  await transact("create market", [
    generated.getCreateKaminoMarketInstruction({
      authority: payer,
      market,
      keeper: payer.address,
    }),
  ]);
  await transact("create, fund and activate bid", plan.instructions);
  const readBid = async () => {
    const a = await account(plan.bid);
    return client.decodeBid(a.data, kit.address(a.owner));
  };
  const fundedBid = await readBid();
  assert.equal(fundedBid.state, generated.BidState.Active);
  assert.equal(fundedBid.remainingFunds, plan.budget);
  assert.equal(
    (await account(plan.escrow)).data.readBigUInt64LE(64),
    plan.budget
  );
  markStage("funded", "confirmed");
  const obligationAddress = kit.address(recorded[17].key);
  const loanAccount = await account(obligationAddress),
    loan = client.readObligation(
      loanAccount.data,
      kit.address(loanAccount.owner)
    );
  const settlement = await client.prepareSettlement({
    keeper: payer,
    bid: await readBid(),
    obligation: obligationAddress,
    borrower: loan.owner,
    expectedDepositedCtokens: loan.depositedCtokens,
    maxRepay: 1_000_000_000n,
    minCollateral: 1n,
    now,
  });
  await transact("create settlement token accounts", settlement.setup);
  // Create a genuine lookup table, rather than injecting its serialized account.
  const slot = BigInt(await rpc("getSlot", [{ commitment: "processed" }]));
  const createTable = await getCreateLookupTableInstructionAsync({
    authority: payer.address,
    payer,
    recentSlot: slot,
  });
  const table = createTable.accounts[0].address;
  await transact("create lookup table", [createTable]);
  const lookupKeys = [
    ...new Set(
      settlement.instructions
        .flatMap((i) => i.accounts.map((a) => a.address))
        .filter((k) => k !== payer.address)
    ),
  ];
  for (let i = 0; i < lookupKeys.length; i += 20)
    await transact("extend lookup table", [
      getExtendLookupTableInstruction({
        address: table,
        authority: payer,
        payer,
        addresses: lookupKeys.slice(i, i + 20),
      }),
    ]);
  await transact("activate lookup table", []);
  setLookupTables({ [table]: lookupKeys });
  await transact("early withdrawal", [plan.withdraw], {
    expectedError: { InstructionError: [1, { Custom: 6002 }] },
  });
  markStage("locked", "rejected-in-simulation");
  const originalOracle = await account(client.KAMINO.scope);
  const setPrice = async (healthy) => {
    const data = Buffer.from(originalOracle.data);
    const currentClock = (
      await account("SysvarC1ock11111111111111111111111111111111")
    ).data;
    for (const i of [332, 269, 13, 456]) {
      const offset = 40 + i * 56;
      data.writeBigUInt64LE(currentClock.readBigUInt64LE(0), offset + 16);
      data.writeBigInt64LE(currentClock.readBigInt64LE(32), offset + 24);
      if (i === 332 || i === 269)
        data.writeBigUInt64LE(
          (healthy ? 225n : 150n) * 10n ** data.readBigUInt64LE(offset + 8),
          offset
        );
    }
    await rpc("surfnet_setAccount", [
      client.KAMINO.scope,
      { data: data.toString("hex") },
    ]);
  };
  await setPrice(true);
  await transact("healthy loan liquidation", settlement.instructions, {
    expectedError: { InstructionError: [4, { Custom: 6016 }] },
  });
  markStage("healthy", "rejected-in-simulation");
  await setPrice(false);
  const stressedOracle = (await account(client.KAMINO.scope)).data;
  for (const i of [332, 269]) {
    const offset = 40 + i * 56;
    assert.equal(
      stressedOracle.readBigUInt64LE(offset) /
        10n ** stressedOracle.readBigUInt64LE(offset + 8),
      150n
    );
  }
  markStage("stressed", "local-override");
  const watched = [
    plan.escrow,
    client.KAMINO.repaySupply,
    plan.providerCollateral,
    settlement.borrowerUsdc,
    plan.sourceUsdc,
    plan.destinationCtoken,
    plan.destinationCollateral,
  ];
  const balances = async () =>
    Promise.all(
      watched.map(async (key) => (await account(key)).data.readBigUInt64LE(64))
    );
  const before = await balances(),
    bidBefore = await readBid();
  await transact(
    "eligible liquidation through real Kamino",
    settlement.instructions
  );
  const after = await balances(),
    bidAfter = await readBid();
  const [paid, repaid, received, residual] = [
    before[0] - after[0],
    after[1] - before[1],
    after[2] - before[2],
    after[3] - before[3],
  ];
  assert(paid > 0n && repaid > 0n && received > 0n);
  assert.equal(paid, repaid + residual);
  assert.equal(
    paid,
    client.fillConsideration(
      bidBefore.quantity - bidBefore.remainingQuantity,
      received,
      bidBefore.price
    )
  );
  assert.equal(
    bidAfter.remainingQuantity,
    bidBefore.remainingQuantity - received
  );
  assert.equal(bidAfter.remainingFunds, bidBefore.remainingFunds - paid);
  for (let i = 4; i < watched.length; i++) assert.equal(before[i], after[i]);
  report.settlement = {
    bid: plan.bid,
    obligation: obligationAddress,
    priceDenomination: "USDC atoms per 100000000 raw NVDAx atoms",
    paidUsdcAtoms: paid,
    repaidUsdcAtoms: repaid,
    borrowerUsdcAtoms: residual,
    deliveredNvdaAtoms: received,
    remainingQuantity: bidAfter.remainingQuantity,
    remainingFunds: bidAfter.remainingFunds,
  };
  markStage("settled", "confirmed");
  console.log(
    `SETTLED: ${client.formatAtoms(repaid, 6)} USDC repaid; ${received} raw NVDAx atoms delivered; ${client.formatAtoms(residual, 6)} USDC borrower surplus`
  );
  await transact("replay with stale bid expectation", settlement.instructions, {
    expectedError: { InstructionError: [4, { Custom: 6004 }] },
  });
  // Show the remaining capacity shortfall at the client boundary without silently reducing the request.
  await assert.rejects(
    () =>
      client.prepareSettlement({
        keeper: payer,
        bid: bidAfter,
        obligation: obligationAddress,
        borrower: loan.owner,
        expectedDepositedCtokens: loan.depositedCtokens,
        maxRepay: bidAfter.remainingFunds + 1n,
        minCollateral: 1n,
        now,
      }),
    /Insufficient bid capacity/
  );
  report.capacityFailure = {
    requestedRepay: bidAfter.remainingFunds + 1n,
    availableFunds: bidAfter.remainingFunds,
    status: "rejected-before-signing",
  };
  save();
  const expiryClock = (
    await account("SysvarC1ock11111111111111111111111111111111")
  ).data;
  expiryClock.writeBigInt64LE(bidAfter.expiry, 32);
  await rpc("surfnet_setAccount", [
    "SysvarC1ock11111111111111111111111111111111",
    { data: expiryClock.toString("hex") },
  ]);
  const beforeWithdrawal = (
    await account(plan.providerUsdc)
  ).data.readBigUInt64LE(64);
  await transact("withdraw unspent funds after expiry", [plan.withdraw]);
  assert.equal((await account(plan.escrow)).data.readBigUInt64LE(64), 0n);
  assert.equal(
    (await account(plan.providerUsdc)).data.readBigUInt64LE(64) -
      beforeWithdrawal,
    bidAfter.remainingFunds
  );
  assert.equal((await readBid()).state, generated.BidState.Withdrawn);
  markStage("withdrawn", "confirmed");
  report.status = "passed";
  save();
  console.log("PASS — receipt saved to build/demo/receipt.json");
} catch (error) {
  report.status = "failed";
  report.error = String(error);
  save();
  throw error;
} finally {
  await runtime.stop();
}

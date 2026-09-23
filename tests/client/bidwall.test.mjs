import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { createNoopSigner, address } from "@solana/kit";
const require = createRequire(import.meta.url);
const client = require("../../build/client/app/lib/bidwall/client.js");
const generated = require("../../build/client/app/generated/bidwall/index.js");
const fixture = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL(
        "../../anchor/programs/bidwall/fixtures/kamino.json.gz",
        import.meta.url
      )
    )
  )
);
const recorded = fixture.instructions.at(-1);
const key = (i) => address(recorded.accounts[i].key);
const bid = client.decodeBid(
  Buffer.from(fixture.accounts[key(2)].data, "base64"),
  generated.BIDWALL_PROGRAM_ADDRESS
);
const obligation = client.readObligation(
  Buffer.from(fixture.accounts[key(17)].data, "base64"),
  client.KAMINO.program
);
const input = {
  keeper: createNoopSigner(key(0)),
  bid,
  obligation: key(17),
  borrower: obligation.owner,
  expectedDepositedCtokens: obligation.depositedCtokens,
  maxRepay: 1_000_000_000n,
  minCollateral: 1n,
  now: bid.start,
};
test("generated client recreates the successful real-lender fixture wire instructions and PDAs", async () => {
  const plan = await client.prepareSettlement(input);
  for (let i = 0; i < 4; i++) {
    const actual = plan.instructions[i],
      expected = fixture.instructions[i];
    assert.equal(actual.programAddress, expected.program);
    assert.deepEqual(
      Buffer.from(actual.data),
      Buffer.from(expected.data, "base64")
    );
    assert.deepEqual(
      actual.accounts.map((a) => ({
        key: a.address,
        writable: (a.role & 1) !== 0,
        signer: (a.role & 2) !== 0,
      })),
      expected.accounts
    );
  }
  assert.equal(plan.bid, key(2));
  assert.equal(plan.escrow, key(3));
  assert.equal(plan.liquidator, key(4));
  assert.equal(plan.setup.length, 5);
});
test("raw amounts preserve precision and reject ambiguous or unrepresentable input", () => {
  assert.equal(client.parseAtoms("184467440737.09551615", 8), client.U64_MAX);
  assert.equal(client.formatAtoms(client.U64_MAX, 8), "184467440737.09551615");
  for (const text of [
    "1e3",
    "-1",
    "1.000000001",
    "1,000",
    "NaN",
    " 1",
    "1.",
    "184467440737.09551616",
  ])
    assert.throws(() => client.parseAtoms(text, 8));
  assert.equal(client.fillConsideration(1n, 1n, 50_000_000n), 1n);
  assert.equal(client.consideration(2n, 50_000_000n), 1n);
  assert.throws(() => client.consideration(client.U64_MAX, client.U64_MAX));
});
test("preparation rejects stale lifecycle and over-budget/min-output bounds", async () => {
  for (const change of [
    { now: bid.expiry },
    { now: bid.start - 1n },
    { maxRepay: bid.remainingFunds + 1n },
    { maxRepay: 0n },
    { minCollateral: bid.remainingQuantity + 1n },
    { minCollateral: 0n },
    { bid: { ...bid, state: 0 } },
    { bid: { ...bid, adapter: client.KAMINO.farms } },
  ])
    await assert.rejects(() =>
      client.prepareSettlement({ ...input, ...change })
    );
});
test("untrusted bid and loan data fail closed before decoding", () => {
  const bidData = Buffer.from(fixture.accounts[key(2)].data, "base64");
  assert.throws(() => client.decodeBid(bidData, client.KAMINO.program));
  assert.throws(() =>
    client.decodeBid(
      bidData.subarray(0, 161),
      generated.BIDWALL_PROGRAM_ADDRESS
    )
  );
  bidData[0] ^= 1;
  assert.throws(() =>
    client.decodeBid(bidData, generated.BIDWALL_PROGRAM_ADDRESS)
  );
  const loan = Buffer.from(fixture.accounts[key(17)].data, "base64");
  assert.throws(() =>
    client.readObligation(loan, generated.BIDWALL_PROGRAM_ADDRESS)
  );
  loan.set(loan.subarray(96, 128), 232);
  assert.throws(() => client.readObligation(loan, client.KAMINO.program));
});

test("failure explanations use program error names and preserve conservative recovery", () => {
  const failure = client.explainSimulationFailure([
    "Program log: AnchorError. Error Code: Replay. Error Number: 6004.",
  ]);
  assert.match(failure.nextStep, /simulate a new bounded transaction/);
  assert.match(
    client.explainSimulationFailure(["custom program error: 0x1774"]).nextStep,
    /Do not submit/
  );
  assert.match(
    client.explainSimulationFailure(["Error Code: LiquidationRewardTooSmall."])
      .nextStep,
    /do not silently loosen/
  );
});

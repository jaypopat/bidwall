// One-off SDK verification of unchanged mainnet fixtures. No network or transactions.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  Obligation,
  Reserve as SdkReserve,
  LendingMarket,
} from "@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/index.js";
import { KaminoReserve } from "@kamino-finance/klend-sdk/dist/classes/reserve.js";
import { KaminoObligation } from "@kamino-finance/klend-sdk/dist/classes/obligation.js";
import { Fraction } from "@kamino-finance/klend-sdk/dist/classes/fraction.js";
import Decimal from "decimal.js";
import {
  decodeLoan,
  decodeMarket,
  decodeReserve,
  SF,
  USD,
} from "../../scripts/risk/kamino.ts";
import { valueLoan } from "../../scripts/risk/valuation.ts";

const fixture = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL("../../tests/risk/fixtures/mainnet.json.gz", import.meta.url)
    )
  ).toString()
);
const account = (row) => ({
  address: row.address,
  owner: row.account.owner,
  data: Buffer.from(row.account.data[0], "base64"),
});
const reserves = new Map();
const sdkReserves = new Map();
const sdkMarket = LendingMarket.decode(account(fixture.market).data);
const market = decodeMarket(account(fixture.market));
assert.equal(market.closeFactorPct, sdkMarket.liquidationMaxDebtCloseFactorPct);
assert.equal(market.insolvencyLtvPct, sdkMarket.insolvencyRiskUnhealthyLtvPct);
assert.equal(
  market.maxRepayUsd,
  BigInt(sdkMarket.maxLiquidatableDebtMarketValueAtOnce.toString()) * USD
);

for (const row of fixture.reserves) {
  const ours = decodeReserve(account(row));
  const sdk = SdkReserve.decode(account(row).data);
  assert.equal(ours.mint, sdk.liquidity.mintPubkey);
  assert.equal(
    ours.availableAtoms,
    BigInt(sdk.liquidity.totalAvailableAmount.toString())
  );
  assert.equal(
    ours.borrowedSf,
    BigInt(sdk.liquidity.borrowedAmountSf.toString())
  );
  assert.equal(ours.priceSf, BigInt(sdk.liquidity.marketPriceSf.toString()));
  assert.equal(
    ours.feesSf,
    BigInt(sdk.liquidity.accumulatedProtocolFeesSf.toString()) +
      BigInt(sdk.liquidity.accumulatedReferrerFeesSf.toString()) +
      BigInt(sdk.liquidity.pendingReferrerFeesSf.toString())
  );
  assert.equal(
    ours.collateralSupply,
    BigInt(sdk.collateral.mintTotalSupply.toString())
  );
  assert.equal(
    ours.liquidationThresholdPct,
    sdk.config.liquidationThresholdPct
  );
  assert.equal(ours.minBonusBps, sdk.config.minLiquidationBonusBps);
  assert.equal(
    ours.borrowFactorPct,
    BigInt(sdk.config.borrowFactorPct.toString())
  );
  reserves.set(row.address, ours);
  sdkReserves.set(
    row.address,
    KaminoReserve.initialize(
      row.address,
      sdk,
      {
        price: new Decimal(ours.priceSf.toString()).div(SF.toString()),
        valid: true,
      },
      null,
      350,
      sdkMarket.reserveRewardsMaxAprBps
    )
  );
}
const sdkMarketView = {
  getReserveByAddress: (address) => sdkReserves.get(address),
};
function close(actual, expected, what) {
  // Each position is floored to micro-dollars before sums/factors; tolerate a few micro-dollars.
  const difference = new Decimal(actual.toString())
    .div(USD.toString())
    .sub(expected)
    .abs();
  assert(
    difference.lt("0.000030"),
    `${what}: ${difference.toString()} USD difference`
  );
}
for (const row of fixture.loans) {
  const encoded = account({ address: row.pubkey, account: row.account });
  const ours = decodeLoan(encoded);
  const sdk = Obligation.decode(encoded.data);
  const rates = new Map(
    sdk.borrows
      .filter((b) => b.borrowedAmountSf.gt(0))
      .map((b) => [
        b.borrowReserve,
        KaminoObligation.getCumulativeBorrowRate(b),
      ])
  );
  // Match the documented no-interest-since-refresh assumption in both calculations.
  const stats = KaminoObligation.calculatePositions(
    sdkMarketView,
    sdk.deposits,
    sdk.borrows,
    0,
    null,
    rates
  ).refreshedStats;
  const valued = valueLoan(ours, reserves);
  close(valued.depositUsd, stats.userTotalDeposit, "deposit");
  close(valued.debtUsd, stats.userTotalBorrow, "debt");
  close(
    valued.adjustedDebtUsd,
    stats.userTotalBorrowBorrowFactorAdjusted,
    "adjusted debt"
  );
  close(
    valued.thresholdUsd,
    stats.borrowLiquidationLimit,
    "liquidation threshold"
  );
  assert.equal(
    valued.liquidatable,
    stats.userTotalBorrowBorrowFactorAdjusted.gte(stats.borrowLiquidationLimit)
  );
  assert.equal(
    ours.borrows[0].borrowedSf,
    BigInt(sdk.borrows[0].borrowedAmountSf.toString())
  );
  assert(new Fraction(sdk.borrowedAssetsMarketValueSf).toDecimal().gte(0));
}
console.log(
  `Verified ${reserves.size} reserve layouts and ${fixture.loans.length} loan valuations against klend-sdk 12.0.0 at slots ${fixture.slot}/${fixture.reserveSlot}.`
);

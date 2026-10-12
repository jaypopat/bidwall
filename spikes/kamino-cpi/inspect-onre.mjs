// Read-only mainnet inspection of the OnRe market's ONyc reserve and its oracle path.
import {
  Reserve,
  LendingMarket,
} from "@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/index.js";
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
async function call(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const b = await r.json();
  if (b.error) throw new Error(JSON.stringify(b.error));
  return b.result;
}
for (const key of process.argv.slice(2)) {
  const a = (await call("getAccountInfo", [key, { encoding: "base64" }])).value;
  const data = Buffer.from(a.data[0], "base64");
  const isMarket = data.length !== 8624;
  const d = (isMarket ? LendingMarket : Reserve).decode(data).toJSON();
  if (isMarket) {
    console.log(
      "market",
      key,
      JSON.stringify({
        name: Buffer.from(d.name).toString().replace(/\0/g, ""),
        elevationGroups: d.elevationGroups?.filter((g) => g.id),
      })
    );
    continue;
  }
  const mint = (
    await call("getAccountInfo", [
      d.liquidity.mintPubkey,
      { encoding: "base64" },
    ])
  ).value;
  console.log(
    key,
    JSON.stringify({
      mint: d.liquidity.mintPubkey,
      mintOwner: mint.owner,
      mintLen: Buffer.from(mint.data[0], "base64").length,
      decimals: d.liquidity.mintDecimals,
      tokenProgram: d.liquidity.tokenProgram,
      farmCollateral: d.farmCollateral,
      farmDebt: d.farmDebt,
      tokenInfo: d.config.tokenInfo,
      ltv: d.config.loanToValuePct,
      liqThreshold: d.config.liquidationThresholdPct,
      minBonus: d.config.minLiquidationBonusBps,
      maxBonus: d.config.maxLiquidationBonusBps,
      badDebtBonus: d.config.badDebtLiquidationBonusBps,
      elevationGroups: d.config.elevationGroups,
      borrowed: d.liquidity.borrowedAmountSf,
      available: d.liquidity.availableAmount,
    })
  );
}

// Read-only: list OnRe obligations with exactly one ONyc deposit and one USDC borrow,
// ranked by last-refreshed LTV. Writes candidates to /tmp/bidwall-onre-obligations.json.
import { writeFileSync } from "node:fs";
import { Obligation } from "@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/index.js";
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const market = "47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8",
  onyc = "6ZxkBSJEqsXA3Kdm2PDAzHLUdPTPUK93Lf4bAezec1UQ",
  usdc = "AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z",
  ZERO = "11111111111111111111111111111111";
const res = await fetch(RPC, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "getProgramAccounts",
    params: [
      "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
      {
        encoding: "base64",
        filters: [
          { dataSize: 3344 },
          { memcmp: { offset: 32, bytes: market } },
          { memcmp: { offset: 96, bytes: onyc } },
        ],
      },
    ],
  }),
});
const body = await res.json();
if (body.error) throw new Error(JSON.stringify(body.error));
const sf = (x) => Number(BigInt(x) >> 40n) / 2 ** 20;
const rows = body.result
  .map((a) => ({
    key: a.pubkey,
    o: Obligation.decode(Buffer.from(a.account.data[0], "base64")).toJSON(),
  }))
  .filter(
    ({ o }) =>
      o.deposits.filter((x) => x.depositReserve !== ZERO).length === 1 &&
      o.borrows.filter((x) => x.borrowReserve !== ZERO).length === 1 &&
      o.borrows[0].borrowReserve === usdc &&
      o.referrer === ZERO
  )
  .map(({ key, o }) => ({
    key,
    owner: o.owner,
    ctokens: o.deposits[0].depositedAmount,
    depositUsd: sf(o.depositedValueSf),
    debtUsd: sf(o.borrows[0].marketValueSf),
    ltv: sf(o.borrows[0].marketValueSf) / sf(o.depositedValueSf),
    lastUpdate: o.lastUpdate.slot,
  }))
  .sort((a, b) => b.ltv - a.ltv);
writeFileSync(
  "/tmp/bidwall-onre-obligations.json",
  JSON.stringify(rows, null, 2)
);
console.log(
  body.result.length,
  "ONyc obligations,",
  rows.length,
  "single ONyc/USDC"
);
console.log(
  rows
    .slice(0, 12)
    .map(
      (r) =>
        `${r.key} ltv=${(r.ltv * 100).toFixed(1)}% dep=$${r.depositUsd.toFixed(0)} debt=$${r.debtUsd.toFixed(0)}`
    )
    .join("\n")
);
const bands = [0.5, 0.6, 0.62, 0.64, 0.66].map(
  (t) =>
    `${t * 100}%+: $${(rows.filter((r) => r.ltv >= t).reduce((s, r) => s + r.debtUsd, 0) / 1e6).toFixed(1)}M`
);
console.log("debt by LTV band:", bands.join("  "));

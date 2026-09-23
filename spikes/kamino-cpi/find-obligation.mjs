import { writeFileSync } from "node:fs";
import { Obligation } from "@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/index.js";
const market = "5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua",
  nvda = "7B66Az3tJhAo4bLkX8PzTixQ9ZGyHkkjxfVLhF26sP5q",
  usdc = "97zoywd8mPZsGTg8q1wdD2Wgkdrs2tqusp1Qqcxbyj7E";
const res = await fetch("https://api.mainnet-beta.solana.com", {
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
          { memcmp: { offset: 96, bytes: nvda } },
        ],
      },
    ],
  }),
});
const body = await res.json();
if (body.error) throw new Error(JSON.stringify(body.error));
const candidates = body.result
  .map((a) => ({
    ...a,
    decoded: Obligation.decode(
      Buffer.from(a.account.data[0], "base64")
    ).toJSON(),
  }))
  .filter(
    (a) =>
      a.decoded.deposits.filter(
        (x) => x.depositReserve !== "11111111111111111111111111111111"
      ).length === 1 &&
      a.decoded.borrows.filter(
        (x) => x.borrowReserve !== "11111111111111111111111111111111"
      ).length === 1 &&
      a.decoded.borrows[0].borrowReserve === usdc
  );
writeFileSync(
  "/tmp/bidwall-obligations.json",
  JSON.stringify(candidates, null, 2)
);
console.log(
  candidates
    .map((x) => ({
      key: x.pubkey,
      ctokens: x.decoded.deposits[0].depositedAmount,
      debt: x.decoded.borrows[0].borrowedAmountSf,
      elevationGroup: x.decoded.elevationGroup,
    }))
    .slice(0, 15)
);

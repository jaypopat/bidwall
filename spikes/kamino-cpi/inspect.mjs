import {
  Reserve,
  LendingMarket,
} from "@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/index.js";
import { account } from "./rpc.mjs";
const market = "5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua";
for (const key of [
  market,
  "7B66Az3tJhAo4bLkX8PzTixQ9ZGyHkkjxfVLhF26sP5q",
  "97zoywd8mPZsGTg8q1wdD2Wgkdrs2tqusp1Qqcxbyj7E",
]) {
  const a = await account(key);
  const d = (key === market ? LendingMarket : Reserve).decode(a.data);
  console.log(key, a.owner, a.data.length, JSON.stringify(d.toJSON()));
}

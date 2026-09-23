/** Narrow public xStocks route, matching the adapter and captured klend v2 interface.
 * Source/schema provenance: docs/KAMINO-INTEGRATION.md. This is not a generic SDK.
 */
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
} from "@solana/kit";
export const KAMINO = {
  program: address("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"),
  market: address("5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua"),
  collateralReserve: address("7B66Az3tJhAo4bLkX8PzTixQ9ZGyHkkjxfVLhF26sP5q"),
  repayReserve: address("97zoywd8mPZsGTg8q1wdD2Wgkdrs2tqusp1Qqcxbyj7E"),
  collateralMint: address("Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"),
  usdcMint: address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  collateralTokenProgram: address(
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
  ),
  tokenProgram: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  scope: address("3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH"),
  farms: address("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr"),
  debtFarm: address("82eHAjSXZEyA3UpBxTjVYXF4QJmAEtLR6kvWXQca7mqd"),
  repaySupply: address("72Gz8BM8vDr5zdeHmFB5A2ptNZYfVgDuw5LDkNwGDdTA"),
  ctokenMint: address("Bx2gmSXWq3SCk5BDuK43LAKZAdmXmAQD5NJ7DySBrrLq"),
  ctokenSupply: address("FtajZ9gSs6tTABZQFRnwSHhrAGvG4KsURSL1SKE3bnEX"),
  collateralSupply: address("29eAnrDKTwiWkBnx4HmVtdCS4BktzuVwQrffRfSbLhfq"),
  collateralFees: address("61pcESuYFX7Lr1okCWpbeZjNeJxeSU9GGBXBUTKRsT7N"),
} as const;
const ZERO = address("11111111111111111111111111111111");
export function readObligation(data: Uint8Array, owner: Address) {
  const discriminator = [168, 206, 141, 106, 88, 76, 172, 167];
  if (
    owner !== KAMINO.program ||
    data.length !== 3344 ||
    !discriminator.every((b, i) => data[i] === b)
  )
    throw new Error("Unsupported obligation owner or schema");
  const key = (offset: number) =>
    getAddressDecoder().decode(data.subarray(offset, offset + 32));
  if (
    key(32) !== KAMINO.market ||
    key(96) !== KAMINO.collateralReserve ||
    key(1208) !== KAMINO.repayReserve
  )
    throw new Error("Unsupported obligation market or reserve pair");
  for (let i = 1; i < 8; i++)
    if (key(96 + i * 136) !== ZERO)
      throw new Error("Multiple collateral reserves are unsupported");
  for (let i = 1; i < 5; i++)
    if (key(1208 + i * 200) !== ZERO)
      throw new Error("Multiple debt reserves are unsupported");
  if (data[2285] !== 0 || key(2288) !== ZERO)
    throw new Error(
      "Referrers and elevation groups are unsupported by this client"
    );
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    owner: key(64),
    depositedCtokens: view.getBigUint64(128, true),
    borrowedSf:
      view.getBigUint64(1296, true) + (view.getBigUint64(1304, true) << 64n),
  };
}
export function refreshInstructions(): Instruction[] {
  const k = KAMINO;
  return [k.repayReserve, k.collateralReserve].map((reserve) => ({
    programAddress: k.program,
    data: new Uint8Array([2, 218, 138, 235, 79, 201, 25, 102]),
    accounts: [
      { address: reserve, role: 1 as const },
      ...[k.market, k.program, k.program, k.program, k.scope].map(
        (address) => ({ address, role: 0 as const })
      ),
    ],
  })) as Instruction[];
}
export function refreshObligationInstruction(obligation: Address): Instruction {
  return {
    programAddress: KAMINO.program,
    data: new Uint8Array([33, 132, 147, 228, 151, 192, 72, 89]),
    accounts: [
      { address: KAMINO.market, role: 0 },
      { address: obligation, role: 1 },
      { address: KAMINO.collateralReserve, role: 1 },
      { address: KAMINO.repayReserve, role: 1 },
    ],
  };
}
export async function liquidationAccounts(input: {
  obligation: Address;
  liquidator: Address;
  sourceUsdc: Address;
  destinationCtoken: Address;
  destinationCollateral: Address;
}) {
  const k = KAMINO,
    encoder = getAddressEncoder();
  const [authority] = await getProgramDerivedAddress({
    programAddress: k.program,
    seeds: [new TextEncoder().encode("lma"), encoder.encode(k.market)],
  });
  const [farmUser] = await getProgramDerivedAddress({
    programAddress: k.farms,
    seeds: [
      new TextEncoder().encode("user"),
      encoder.encode(k.debtFarm),
      encoder.encode(input.obligation),
    ],
  });
  const keys = [
    input.liquidator,
    input.obligation,
    k.market,
    authority,
    k.repayReserve,
    k.usdcMint,
    k.repaySupply,
    k.collateralReserve,
    k.collateralMint,
    k.ctokenMint,
    k.ctokenSupply,
    k.collateralSupply,
    k.collateralFees,
    input.sourceUsdc,
    input.destinationCtoken,
    input.destinationCollateral,
    k.tokenProgram,
    k.tokenProgram,
    k.collateralTokenProgram,
    address("Sysvar1nstructions1111111111111111111111111"),
    k.program,
    k.program,
    farmUser,
    k.debtFarm,
    k.farms,
    k.collateralReserve,
  ];
  const writable = new Set([1, 4, 6, 7, 9, 10, 11, 12, 13, 14, 15, 22, 23, 25]);
  return keys.map((address, index) => ({
    address,
    role: writable.has(index) ? (1 as const) : (0 as const),
  }));
}

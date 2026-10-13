/** Narrow Kamino routes, matching the adapter's pair table and the captured klend
 * v2 interface. This is not
 * a generic SDK: every account below is pinned per supported reserve pair.
 */
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
} from "@solana/kit";

/** Accounts shared by every supported pair. */
export const KAMINO = {
  program: address("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"),
  usdcMint: address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  tokenProgram: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  scope: address("3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH"),
  farms: address("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr"),
} as const;

/** One lending market's collateral/USDC reserve pair and its token accounts. */
export type KaminoPair = {
  id: "nvdax" | "onyc";
  symbol: string;
  decimals: number;
  /** Raw collateral atoms per whole token; bid prices are USDC atoms per scale. */
  scale: bigint;
  market: Address;
  collateralReserve: Address;
  repayReserve: Address;
  collateralMint: Address;
  collateralTokenProgram: Address;
  debtFarm: Address;
  repaySupply: Address;
  ctokenMint: Address;
  ctokenSupply: Address;
  collateralSupply: Address;
  collateralFees: Address;
};

export const KAMINO_PAIRS: Record<KaminoPair["id"], KaminoPair> = {
  /** Public xStocks market: NVDAx is Token-2022 with a scaled UI amount. */
  nvdax: {
    id: "nvdax",
    symbol: "NVDAx",
    decimals: 8,
    scale: 100_000_000n,
    market: address("5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua"),
    collateralReserve: address("7B66Az3tJhAo4bLkX8PzTixQ9ZGyHkkjxfVLhF26sP5q"),
    repayReserve: address("97zoywd8mPZsGTg8q1wdD2Wgkdrs2tqusp1Qqcxbyj7E"),
    collateralMint: address("Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"),
    collateralTokenProgram: address(
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
    ),
    debtFarm: address("82eHAjSXZEyA3UpBxTjVYXF4QJmAEtLR6kvWXQca7mqd"),
    repaySupply: address("72Gz8BM8vDr5zdeHmFB5A2ptNZYfVgDuw5LDkNwGDdTA"),
    ctokenMint: address("Bx2gmSXWq3SCk5BDuK43LAKZAdmXmAQD5NJ7DySBrrLq"),
    ctokenSupply: address("FtajZ9gSs6tTABZQFRnwSHhrAGvG4KsURSL1SKE3bnEX"),
    collateralSupply: address("29eAnrDKTwiWkBnx4HmVtdCS4BktzuVwQrffRfSbLhfq"),
    collateralFees: address("61pcESuYFX7Lr1okCWpbeZjNeJxeSU9GGBXBUTKRsT7N"),
  },
  /** OnRe market: ONyc tokenized reinsurance is classic SPL with 9 decimals. */
  onyc: {
    id: "onyc",
    symbol: "ONyc",
    decimals: 9,
    scale: 1_000_000_000n,
    market: address("47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8"),
    collateralReserve: address("6ZxkBSJEqsXA3Kdm2PDAzHLUdPTPUK93Lf4bAezec1UQ"),
    repayReserve: address("AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z"),
    collateralMint: address("5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5"),
    collateralTokenProgram: address(
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    ),
    debtFarm: address("7vNfe1qX8iDxP5p3A4fosrjLqdn1YjmmGcZZkG2b4APF"),
    repaySupply: address("8BkQTZsT8ssKMU643De4iiV5Wf3pENdUFTsdtHPueKjB"),
    ctokenMint: address("CtzvqjvpxJDXyraDjP2QrEr8b1xvGvxADRV7w29qrmxd"),
    ctokenSupply: address("2c42iUaea3QVLvSPQHUBZBwqdvpiQo5vmeMePq9qx8eo"),
    collateralSupply: address("9YuHgsPVGgWrkpsaRZmeZCV2uXweMEn6TEAcusQKRjgG"),
    collateralFees: address("6uDJD7iVkf84S1rZsbkPzxgnwgGvFaeMWmykUXEwyELT"),
  },
};

export function kaminoPair(id: string): KaminoPair {
  const pair = KAMINO_PAIRS[id as KaminoPair["id"]];
  if (!pair) throw new Error(`Unsupported Kamino pair: ${id}`);
  return pair;
}

const ZERO = address("11111111111111111111111111111111");
export function readObligation(
  data: Uint8Array,
  owner: Address,
  pair: KaminoPair
) {
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
    key(32) !== pair.market ||
    key(96) !== pair.collateralReserve ||
    key(1208) !== pair.repayReserve
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
export function refreshInstructions(pair: KaminoPair): Instruction[] {
  return [pair.repayReserve, pair.collateralReserve].map((reserve) => ({
    programAddress: KAMINO.program,
    data: new Uint8Array([2, 218, 138, 235, 79, 201, 25, 102]),
    accounts: [
      { address: reserve, role: 1 as const },
      ...[
        pair.market,
        KAMINO.program,
        KAMINO.program,
        KAMINO.program,
        KAMINO.scope,
      ].map((address) => ({ address, role: 0 as const })),
    ],
  })) as Instruction[];
}
export function refreshObligationInstruction(
  pair: KaminoPair,
  obligation: Address
): Instruction {
  return {
    programAddress: KAMINO.program,
    data: new Uint8Array([33, 132, 147, 228, 151, 192, 72, 89]),
    accounts: [
      { address: pair.market, role: 0 },
      { address: obligation, role: 1 },
      { address: pair.collateralReserve, role: 1 },
      { address: pair.repayReserve, role: 1 },
    ],
  };
}
export async function liquidationAccounts(
  pair: KaminoPair,
  input: {
    obligation: Address;
    liquidator: Address;
    sourceUsdc: Address;
    destinationCtoken: Address;
    destinationCollateral: Address;
  }
) {
  const encoder = getAddressEncoder();
  const [authority] = await getProgramDerivedAddress({
    programAddress: KAMINO.program,
    seeds: [new TextEncoder().encode("lma"), encoder.encode(pair.market)],
  });
  const [farmUser] = await getProgramDerivedAddress({
    programAddress: KAMINO.farms,
    seeds: [
      new TextEncoder().encode("user"),
      encoder.encode(pair.debtFarm),
      encoder.encode(input.obligation),
    ],
  });
  const keys = [
    input.liquidator,
    input.obligation,
    pair.market,
    authority,
    pair.repayReserve,
    KAMINO.usdcMint,
    pair.repaySupply,
    pair.collateralReserve,
    pair.collateralMint,
    pair.ctokenMint,
    pair.ctokenSupply,
    pair.collateralSupply,
    pair.collateralFees,
    input.sourceUsdc,
    input.destinationCtoken,
    input.destinationCollateral,
    KAMINO.tokenProgram,
    KAMINO.tokenProgram,
    pair.collateralTokenProgram,
    address("Sysvar1nstructions1111111111111111111111111"),
    KAMINO.program,
    KAMINO.program,
    farmUser,
    pair.debtFarm,
    KAMINO.farms,
    pair.collateralReserve,
  ];
  const writable = new Set([1, 4, 6, 7, 9, 10, 11, 12, 13, 14, 15, 22, 23, 25]);
  return keys.map((address, index) => ({
    address,
    role: writable.has(index) ? (1 as const) : (0 as const),
  }));
}

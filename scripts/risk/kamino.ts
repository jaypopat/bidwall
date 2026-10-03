import { TRACKED_TOKENS, USDC } from "../quotes/tokens.ts";

export const PROGRAM = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
export const MARKET = "5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua";
export const ZERO = "11111111111111111111111111111111";
export const SF = 1n << 60n;
export const USD = 1_000_000n;
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Small, dependency-free address codec for the fixed 32-byte account keys. */
export function addressFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== 32) throw new Error("Address must contain 32 bytes");
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);
  let result = "";
  while (value > 0n) {
    result = BASE58[Number(value % 58n)] + result;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = "1" + result;
  }
  return result;
}

export function addressBytes(address: string): Buffer {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))
    throw new Error("Invalid account address");
  let value = 0n;
  for (const char of address)
    value = value * 58n + BigInt(BASE58.indexOf(char));
  const bytes = Buffer.alloc(32);
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(value & 255n);
    value >>= 8n;
  }
  if (value !== 0n || addressFromBytes(bytes) !== address)
    throw new Error("Invalid account address");
  return bytes;
}

const TOKENS = [
  ...TRACKED_TOKENS,
  { ...USDC, symbol: "USDC" },
  {
    mint: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij",
    symbol: "cbBTC",
    decimals: 8,
  },
  {
    mint: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
    symbol: "USDG",
    decimals: 6,
  },
];

export type Account = { address: string; owner: string; data: Buffer };
export type Loan = {
  address: string;
  owner: string;
  lastUpdateSlot: string;
  elevationGroup: number;
  deposits: { reserve: string; ctokens: bigint }[];
  borrows: { reserve: string; borrowedSf: bigint }[];
};
export type Reserve = {
  address: string;
  mint: string;
  symbol: string;
  decimals: number;
  lastUpdateSlot: string;
  priceUpdatedAt: string;
  availableAtoms: bigint;
  borrowedSf: bigint;
  priceSf: bigint;
  feesSf: bigint;
  collateralSupply: bigint;
  liquidationThresholdPct: number;
  minBonusBps: number;
  borrowFactorPct: bigint;
};
export type Market = {
  closeFactorPct: number;
  insolvencyLtvPct: number;
  minFullLiquidationUsd: bigint;
  maxRepayUsd: bigint;
  emergencyMode: boolean;
  priceLiquidationDisabled: boolean;
};

const u128 = (data: Buffer, offset: number) =>
  data.readBigUInt64LE(offset) + (data.readBigUInt64LE(offset + 8) << 64n);
const key = (data: Buffer, offset: number) =>
  addressFromBytes(data.subarray(offset, offset + 32));

function checked(
  account: Account,
  size: number,
  discriminator: number[]
): Buffer {
  addressBytes(account.address);
  if (account.owner !== PROGRAM) throw new Error("Wrong account program owner");
  if (account.data.length !== size) throw new Error("Unsupported account size");
  if (!discriminator.every((byte, i) => account.data[i] === byte))
    throw new Error("Wrong account discriminator");
  return account.data;
}

function inMarket(data: Buffer) {
  if (key(data, 32) !== MARKET) throw new Error("Wrong lending market");
}

export function decodeLoan(account: Account): Loan {
  const data = checked(account, 3344, [168, 206, 141, 106, 88, 76, 172, 167]);
  inMarket(data);
  if (data[2287] !== 1) throw new Error("Expected an indebted obligation");
  const deposits: Loan["deposits"] = [];
  const borrows: Loan["borrows"] = [];
  for (let i = 0; i < 8; i++) {
    const offset = 96 + i * 136;
    const reserve = key(data, offset);
    const ctokens = data.readBigUInt64LE(offset + 32);
    if (reserve !== ZERO && ctokens > 0n) deposits.push({ reserve, ctokens });
  }
  for (let i = 0; i < 5; i++) {
    const offset = 1208 + i * 200;
    const reserve = key(data, offset);
    const borrowedSf = u128(data, offset + 88);
    if (reserve !== ZERO && borrowedSf > 0n)
      borrows.push({ reserve, borrowedSf });
  }
  return {
    address: account.address,
    owner: key(data, 64),
    lastUpdateSlot: data.readBigUInt64LE(16).toString(),
    elevationGroup: data.readUInt8(2285),
    deposits,
    borrows,
  };
}

export function decodeReserve(account: Account): Reserve {
  const data = checked(account, 8624, [43, 242, 204, 202, 26, 247, 59, 127]);
  inMarket(data);
  const mint = key(data, 128);
  const decimals = Number(data.readBigUInt64LE(272));
  const token = TOKENS.find((t) => t.mint === mint);
  const liquidationThresholdPct = data.readUInt8(4873);
  const minBonusBps = data.readUInt16LE(4874);
  const borrowFactorPct = data.readBigUInt64LE(5008);
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18 ||
    (token && token.decimals !== decimals) ||
    liquidationThresholdPct > 100 ||
    minBonusBps > 10_000 ||
    borrowFactorPct < 100n
  )
    throw new Error("Unsupported reserve configuration");
  return {
    address: account.address,
    mint,
    symbol: token?.symbol ?? mint,
    decimals,
    lastUpdateSlot: data.readBigUInt64LE(16).toString(),
    priceUpdatedAt: data.readBigUInt64LE(264).toString(),
    availableAtoms: data.readBigUInt64LE(224),
    borrowedSf: u128(data, 232),
    priceSf: u128(data, 248),
    feesSf: u128(data, 344) + u128(data, 360) + u128(data, 376),
    collateralSupply: data.readBigUInt64LE(2592),
    liquidationThresholdPct,
    minBonusBps,
    borrowFactorPct,
  };
}

export function decodeMarket(account: Account): Market {
  const data = checked(account, 4664, [246, 114, 50, 98, 72, 157, 28, 120]);
  if (account.address !== MARKET) throw new Error("Wrong market address");
  const closeFactorPct = data.readUInt8(126);
  const insolvencyLtvPct = data.readUInt8(127);
  if (
    closeFactorPct < 1 ||
    closeFactorPct > 100 ||
    insolvencyLtvPct > 100 ||
    data[122]! > 1 ||
    data[3307]! > 1
  )
    throw new Error("Unsupported market configuration");
  return {
    closeFactorPct,
    insolvencyLtvPct,
    minFullLiquidationUsd: data.readBigUInt64LE(128) * USD,
    maxRepayUsd: data.readBigUInt64LE(136) * USD,
    emergencyMode: data[122] === 1,
    priceLiquidationDisabled: data[3307] === 1,
  };
}

import {
  type Address,
  type TransactionSigner,
  type Instruction,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token";
import {
  BIDWALL_PROGRAM_ADDRESS,
  BID_DISCRIMINATOR,
  BidState,
  getBidDecoder,
  findBidPda,
  findEscrowPda,
  findSettleKaminoLiquidatorPda,
  getCreateBidInstruction,
  getFundBidInstruction,
  getActivateBidInstruction,
  getWithdrawBidInstruction,
  getSettleKaminoInstruction,
  type Bid,
} from "../../generated/bidwall";
import {
  KAMINO,
  liquidationAccounts,
  refreshInstructions,
  refreshObligationInstruction,
  type KaminoPair,
} from "./kamino";
import { assertU64, consideration } from "./units";
export * from "./units";
export * from "./kamino";
export * from "./demo-terms";
export function decodeBid(data: Uint8Array, owner: Address): Bid {
  if (
    owner !== BIDWALL_PROGRAM_ADDRESS ||
    data.length !== 162 ||
    !BID_DISCRIMINATOR.every((b, i) => data[i] === b)
  )
    throw new Error("Invalid Bidwall bid account");
  return getBidDecoder().decode(data);
}
export async function bidAddresses(
  pair: KaminoPair,
  provider: Address,
  id: bigint
) {
  const [bid] = await findBidPda({ provider, id: assertU64(id) });
  const [[escrow], [liquidator]] = await Promise.all([
    findEscrowPda({ bid }),
    findSettleKaminoLiquidatorPda({ bid }),
  ]);
  const ata = async (owner: Address, mint: Address, tokenProgram: Address) =>
    (await findAssociatedTokenPda({ owner, mint, tokenProgram }))[0];
  return {
    bid,
    escrow,
    liquidator,
    providerUsdc: await ata(provider, KAMINO.usdcMint, KAMINO.tokenProgram),
    providerCollateral: await ata(
      provider,
      pair.collateralMint,
      pair.collateralTokenProgram
    ),
    sourceUsdc: await ata(liquidator, KAMINO.usdcMint, KAMINO.tokenProgram),
    destinationCtoken: await ata(
      liquidator,
      pair.ctokenMint,
      KAMINO.tokenProgram
    ),
    destinationCollateral: await ata(
      liquidator,
      pair.collateralMint,
      pair.collateralTokenProgram
    ),
  };
}
export async function prepareBid(input: {
  pair: KaminoPair;
  provider: TransactionSigner;
  market: Address;
  id: bigint;
  price: bigint;
  quantity: bigint;
  start: bigint;
  expiry: bigint;
  now: bigint;
}) {
  const { pair, provider, market, id, price, quantity, start, expiry, now } =
    input;
  if (
    price <= 0n ||
    quantity <= 0n ||
    start >= expiry ||
    expiry <= now ||
    start < -(1n << 63n) ||
    expiry >= 1n << 63n
  )
    throw new Error("Invalid bid terms or time window");
  const budget = consideration(quantity, price, pair.scale);
  if (budget === 0n) throw new Error("Bid budget rounds to zero");
  const accounts = await bidAddresses(pair, provider.address, id);
  const common = { ...accounts, provider, market, usdcMint: KAMINO.usdcMint };
  return {
    ...accounts,
    budget,
    instructions: [
      getCreateBidInstruction({
        ...common,
        id,
        price,
        quantity,
        start,
        expiry,
      }),
      getFundBidInstruction(common),
      getActivateBidInstruction(common),
    ],
    withdraw: getWithdrawBidInstruction(common),
  };
}
export async function prepareSettlement(input: {
  pair: KaminoPair;
  keeper: TransactionSigner;
  bid: Bid;
  obligation: Address;
  borrower: Address;
  expectedDepositedCtokens: bigint;
  maxRepay: bigint;
  minCollateral: bigint;
  now: bigint;
}) {
  const {
    pair,
    bid,
    keeper,
    obligation,
    borrower,
    expectedDepositedCtokens,
    maxRepay,
    minCollateral,
    now,
  } = input;
  if (bid.adapter !== KAMINO.program)
    throw new Error("Unsupported lender adapter");
  if (bid.state !== BidState.Active) throw new Error("Bid is not active");
  if (now < bid.start || now >= bid.expiry)
    throw new Error("Outside commitment window");
  if (
    assertU64(maxRepay) === 0n ||
    maxRepay > bid.remainingFunds ||
    assertU64(minCollateral) === 0n ||
    minCollateral > bid.remainingQuantity
  )
    throw new Error("Insufficient bid capacity for requested bounds");
  assertU64(expectedDepositedCtokens);
  const accounts = await bidAddresses(pair, bid.provider, bid.id);
  const [borrowerUsdc] = await findAssociatedTokenPda({
    owner: borrower,
    mint: KAMINO.usdcMint,
    tokenProgram: KAMINO.tokenProgram,
  });
  const setup: Instruction[] = [];
  for (const [owner, mint, tokenProgram, ata] of [
    [
      accounts.liquidator,
      KAMINO.usdcMint,
      KAMINO.tokenProgram,
      accounts.sourceUsdc,
    ],
    [
      accounts.liquidator,
      pair.ctokenMint,
      KAMINO.tokenProgram,
      accounts.destinationCtoken,
    ],
    [
      accounts.liquidator,
      pair.collateralMint,
      pair.collateralTokenProgram,
      accounts.destinationCollateral,
    ],
    [
      bid.provider,
      pair.collateralMint,
      pair.collateralTokenProgram,
      accounts.providerCollateral,
    ],
    [borrower, KAMINO.usdcMint, KAMINO.tokenProgram, borrowerUsdc],
  ] as const)
    setup.push(
      getCreateAssociatedTokenIdempotentInstruction({
        payer: keeper,
        owner,
        mint,
        tokenProgram,
        ata,
      })
    );
  const ix = getSettleKaminoInstruction({
    ...accounts,
    keeper,
    market: bid.market,
    borrowerUsdc,
    repaySupply: pair.repaySupply,
    collateralMint: pair.collateralMint,
    collateralTokenProgram: pair.collateralTokenProgram,
    maxRepay,
    minCollateral,
    expectedRemaining: bid.remainingQuantity,
    expectedDepositedCtokens,
  });
  const settlement: Instruction = {
    ...ix,
    accounts: [
      ...ix.accounts,
      ...(await liquidationAccounts(pair, { ...accounts, obligation })),
    ],
  };
  return {
    ...accounts,
    borrowerUsdc,
    setup,
    instructions: [
      ...refreshInstructions(pair),
      refreshObligationInstruction(pair, obligation),
      settlement,
    ],
  };
}

export * from "./failures";

// Fork scenario targets. Each mirrors a pair in the program's Kamino adapter table.
// Select with PAIR=nvdax (default) or PAIR=onyc.
import BN from "bn.js";

export const PAIRS = {
  nvdax: {
    label: "NVDAx",
    market: "5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua",
    collateralReserve: "7B66Az3tJhAo4bLkX8PzTixQ9ZGyHkkjxfVLhF26sP5q",
    usdcReserve: "97zoywd8mPZsGTg8q1wdD2Wgkdrs2tqusp1Qqcxbyj7E",
    obligation: "H3PyTc8j5Xq4EmDh1vS7AbY73293evzXXsAbxkm1QUj",
    lookupTable: "8ofreL6hKfEet1DnhHVGvCTnSdz4pg85PpbuCUHnEcKm",
    scale: 100_000_000n,
    // Scope indices: collateral spot/TWAP are stressed; all four get fresh timestamps.
    stressedIndices: [332, 269],
    freshIndices: [332, 269, 13, 456],
    stressPrice: (exp) => new BN(150).mul(new BN(10).pow(exp)),
    stressLabel: "NVDA 150",
    quantity: 1_000_000_000n, // 10 NVDAx in raw atoms
    price: 150_000_000n, // 150 USDC per 10^8 atoms
    captureFixture: true,
  },
  onyc: {
    label: "ONyc",
    market: "47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8",
    collateralReserve: "6ZxkBSJEqsXA3Kdm2PDAzHLUdPTPUK93Lf4bAezec1UQ",
    usdcReserve: "AYL4LMc4ZCVyq3Z7XPJGWDM4H9PiWjqXAAuuHBEGVR2Z",
    // Real looped borrower at the 66% max LTV (liquidation threshold 75%).
    obligation: "4RUxiY9Hb3qLPY3FvRFoMGMpYpDfYJP9iU5HkhDK3iqU",
    lookupTable: "6D8Roriqv9yeDotBSFFKwDdHtvvn4eXYopdFx2zpBbDP",
    scale: 1_000_000_000n,
    stressedIndices: [350, 478],
    freshIndices: [350, 478, 13, 456],
    // 0.95 is the reserve's lowest accepted price (heuristic lower bound).
    stressPrice: (exp) => new BN(95).mul(new BN(10).pow(exp.subn(2))),
    stressLabel: "ONyc NAV 0.95",
    quantity: 5_000_000_000_000n, // 5,000 ONyc in raw atoms
    price: 1_000_000n, // 1.00 USDC per whole ONyc: a redemption-backed standing bid
    captureFixture: false,
  },
};

export const PAIR = PAIRS[process.env.PAIR ?? "nvdax"];
if (!PAIR) throw new Error(`Unknown PAIR ${process.env.PAIR}`);

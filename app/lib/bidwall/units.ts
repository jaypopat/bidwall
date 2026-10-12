/** Fixed-point raw token units. Never use floating-point numbers for bid terms. */
export const U64_MAX = (1n << 64n) - 1n;
export function assertU64(value: bigint): bigint {
  if (value < 0n || value > U64_MAX)
    throw new Error("Amount is outside u64 range");
  return value;
}
export function parseAtoms(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)
    throw new Error("Invalid decimals");
  if (!/^\d+(\.\d+)?$/.test(value))
    throw new Error(
      "Use an unsigned decimal amount, without exponent notation"
    );
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals)
    throw new Error(`At most ${decimals} decimal places are allowed`);
  return assertU64(
    BigInt(whole!) * 10n ** BigInt(decimals) +
      BigInt(fraction.padEnd(decimals, "0") || "0")
  );
}
export function formatAtoms(value: bigint, decimals: number): string {
  assertU64(value);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)
    throw new Error("Invalid decimals");
  if (decimals === 0) return value.toString();
  const digits = value.toString().padStart(decimals + 1, "0");
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}
/** Same cumulative-floor rounding as the on-chain program. `scale` is the raw
 * collateral atoms per whole token (10^decimals) that the bid price refers to. */
export function consideration(
  quantity: bigint,
  price: bigint,
  scale: bigint
): bigint {
  if (scale <= 0n) throw new Error("Invalid collateral scale");
  return assertU64((assertU64(quantity) * assertU64(price)) / scale);
}
export function fillConsideration(
  filled: bigint,
  received: bigint,
  price: bigint,
  scale: bigint
): bigint {
  return (
    consideration(assertU64(filled + received), price, scale) -
    consideration(filled, price, scale)
  );
}

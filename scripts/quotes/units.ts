/**
 * Fixed-point arithmetic for quotes. Token amounts are raw atoms (bigint);
 * prices carry 12 decimal places. Floats appear only in display helpers.
 */
export const PRICE_SCALE = 10n ** 12n;
const PRICE_DECIMALS = 12;
const BPS = 10_000n;
const MAX_PRICE_USD = 1e9;

export type Amount = { atoms: bigint; decimals: number };

const pow10 = (decimals: number) => 10n ** BigInt(decimals);

/** Converts an API price (a JSON number) to fixed point, rejecting values we cannot trust. */
export function parsePrice(usd: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0 || usd >= MAX_PRICE_USD)
    throw new Error(`Unusable price: ${usd}`);
  const [whole = "0", fraction = ""] = usd.toFixed(PRICE_DECIMALS).split(".");
  const price =
    BigInt(whole) * PRICE_SCALE + BigInt(fraction.padEnd(PRICE_DECIMALS, "0"));
  // A price below 10^-12 rounds to zero and would later divide by zero.
  if (price === 0n) throw new Error(`Unusable price: ${usd}`);
  return price;
}

/** Raw atoms worth `usd` whole dollars at `price`, rounded down. */
export function atomsForUsd(
  usd: bigint,
  decimals: number,
  price: bigint
): bigint {
  return (usd * pow10(decimals) * PRICE_SCALE) / price;
}

/** Dollar value of `atoms` at `price`, in whole cents, rounded down. */
export function centsForAtoms(
  atoms: bigint,
  decimals: number,
  price: bigint
): bigint {
  return (atoms * price * 100n) / (pow10(decimals) * PRICE_SCALE);
}

export function formatCents(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/**
 * Signed difference between the quote's effective price and the reference
 * price, in basis points. Rounds toward negative infinity so a quote never
 * looks better than it is.
 */
export function deviationBps(
  sold: Amount,
  received: Amount,
  price: bigint
): number {
  if (sold.atoms <= 0n) throw new Error("Cannot price a zero-sized sale");
  const numerator = received.atoms * pow10(sold.decimals) * BPS * PRICE_SCALE;
  const denominator = sold.atoms * price * pow10(received.decimals);
  return Number(numerator / denominator - BPS);
}

/** "+0.18%", "−33.85%", "0.00%". */
export function formatBps(bps: number): string {
  const sign = bps > 0 ? "+" : bps < 0 ? "−" : "";
  return `${sign}${(Math.abs(bps) / 100).toFixed(2)}%`;
}

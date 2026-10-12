/** Display helpers for raw token atoms. Bigint only: never round through floats. */

export function usd(atoms?: string | bigint, places = 6) {
  if (atoms === undefined) return "—";
  // Round only the display, using integer arithmetic. Settlement values stay exact.
  const precision = 10n ** BigInt(6 - places);
  const rounded = ((BigInt(atoms) + precision / 2n) / precision) * precision;
  return tokens(rounded, 6, places, places);
}

/** Raw atoms as a whole-token amount with between `min` and `max` decimals. */
export function tokens(
  atoms: string | bigint | undefined,
  decimals: number,
  max = decimals,
  min = 0
) {
  if (atoms === undefined) return "—";
  const value = BigInt(atoms);
  const scale = 10n ** BigInt(decimals);
  let fraction = (value % scale)
    .toString()
    .padStart(decimals, "0")
    .slice(0, max)
    .replace(/0+$/, "");
  fraction = fraction.padEnd(min, "0");
  return `${(value / scale).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

export function integer(atoms?: string) {
  return atoms ? BigInt(atoms).toLocaleString("en-US") : "—";
}

export function short(value?: string) {
  return value ? `${value.slice(0, 6)}…${value.slice(-6)}` : "—";
}

export function timestamp(value?: string) {
  return value
    ? new Date(value).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      }) + " UTC"
    : "—";
}

export function unixTime(seconds?: string) {
  return seconds
    ? timestamp(new Date(Number(seconds) * 1000).toISOString())
    : "—";
}

/** Float for animation only, never for displayed exact amounts. */
export function approx(atoms: string | undefined, decimals: number) {
  return atoms ? Number(BigInt(atoms)) / 10 ** decimals : 0;
}

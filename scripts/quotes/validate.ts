/** Readers for untrusted JSON. Each throws `ShapeError` rather than guessing. */
export class ShapeError extends Error {}

type Obj = Record<string, unknown>;

export function readRecord(value: unknown, what: string): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ShapeError(`${what} must be an object`);
  return value as Obj;
}

export function readString(obj: Obj, key: string): string {
  const value = obj[key];
  if (typeof value !== "string")
    throw new ShapeError(`${key} must be a string`);
  return value;
}

export function readNumber(obj: Obj, key: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new ShapeError(`${key} must be a finite number`);
  return value;
}

export function readOptionalNumber(obj: Obj, key: string): number | null {
  return obj[key] === undefined || obj[key] === null
    ? null
    : readNumber(obj, key);
}

export function readIntegerString(obj: Obj, key: string): bigint {
  const value = obj[key];
  if (typeof value !== "string" || !/^\d+$/.test(value))
    throw new ShapeError(`${key} must be an integer string`);
  return BigInt(value);
}

export function readArray(obj: Obj, key: string): unknown[] {
  const value = obj[key];
  if (!Array.isArray(value)) throw new ShapeError(`${key} must be an array`);
  return value;
}

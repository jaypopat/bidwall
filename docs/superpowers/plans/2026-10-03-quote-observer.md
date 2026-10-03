# Quote Observer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record hourly, verifiable Jupiter sell quotes for five xStocks (including the exact Bidwall demo lot) as an append-only time series, labelled by US market session.

**Architecture:** Small single-purpose TypeScript modules under `scripts/quotes/` (constants, fixed-point maths, session clock, Jupiter client, observation builder, storage, report). Pure logic is tested with `bun test` and a fake `fetch`; nothing in tests touches the network. A GitHub Actions workflow on `main` runs the observer hourly and commits results to a separate `evidence/quotes` branch.

**Tech Stack:** TypeScript (strict), Bun 1.4.2 runtime and test runner, `node:` standard modules only, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-03-quote-observer-design.md`

## Global Constraints

- Read-only: never build, sign, simulate or send a transaction.
- Tokens are identified by mint from the allowlist; never by symbol.
- All token amounts are `bigint` raw atoms; prices are fixed point with 12 decimals (`PRICE_SCALE = 10n ** 12n`); floats only for display.
- `slippageBps` is exactly `50`.
- Every observation carries `label: "Mainnet Jupiter quote, not executed"` and `schema: "bidwall.quote-observation/v1"`.
- No runtime dependencies. One new dev dependency: `@types/bun`.
- Imports use explicit `.ts` extensions and `import type` for types (`verbatimModuleSyntax`).
- pnpm remains the package manager; scripts run with Bun.
- Hourly bot commits go only to branch `evidence/quotes`, never `main`.
- Commit after each task with a conventional message ending in `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

- A quote whose `inputMint` or `inAmount` does not echo the request must be recorded as `error`, never as `ok` (Task 4 test).
- Extra or malformed token-API entries for mints we did not ask about must be ignored; a malformed entry for a requested mint fails the lookup (Task 3 test).
- A zero, negative or non-finite reference price must skip that token with a stated reason, never divide by zero (Tasks 1 and 4 tests).
- Saving on a day that already has a file must append and keep earlier lines; a new UTC day starts a new file (Task 5 test).
- `fetch` throwing (DNS or network failure) must be retried once, then recorded as `error` while the run continues (Task 3 test).

## File Structure

| Path                                    | Responsibility                                                      |
| --------------------------------------- | ------------------------------------------------------------------- |
| `tsconfig.scripts.json`                 | Strict type-check settings for Bun scripts and tests                |
| `scripts/quotes/tokens.ts`              | Allowlisted mints, USDC, lot ladder, demo lot, slippage             |
| `scripts/quotes/units.ts`               | Price parsing, lot sizing, notional, deviation, display formatting  |
| `scripts/quotes/session.ts`             | New York clock and market-session classification                    |
| `scripts/quotes/validate.ts`            | Small fail-closed readers for untrusted JSON                        |
| `scripts/quotes/jupiter.ts`             | Typed Jupiter token and quote client with retry                     |
| `scripts/quotes/types.ts`               | Observation record types (the stored schema)                        |
| `scripts/quotes/observe.ts`             | Builds one observation; CLI entry point                             |
| `scripts/quotes/store.ts`               | Writes the gzip raw file and appends the JSONL summary              |
| `scripts/quotes/report.ts`              | Summarises stored observations as a Markdown table; CLI entry point |
| `tests/quotes/*.test.ts`, `fixtures.ts` | Tests and shared fakes                                              |
| `.github/workflows/quote-observer.yml`  | Hourly schedule                                                     |
| `docs/QUOTE-OBSERVER.md`                | How to run and read the data                                        |

---

### Task 1: Bun/TypeScript tooling, constants and fixed-point units

**Files:**

- Create: `tsconfig.scripts.json`, `scripts/quotes/tokens.ts`, `scripts/quotes/units.ts`, `tests/quotes/units.test.ts`
- Modify: `tsconfig.json` (exclude list), `package.json` (scripts, dev dependency, `ci`)

**Interfaces:**

- Produces (`tokens.ts`): `type TrackedToken = { symbol: string; mint: string; decimals: number }`, `USDC: { mint: string; decimals: 6 }`, `TRACKED_TOKENS: readonly TrackedToken[]`, `USD_LADDER: readonly bigint[]`, `DEMO_LOT: { symbol: "NVDAx"; atoms: bigint }`, `SLIPPAGE_BPS: 50`
- Produces (`units.ts`): `PRICE_SCALE`, `parsePrice(usd: number): bigint`, `atomsForUsd(usd: bigint, decimals: number, price: bigint): bigint`, `centsForAtoms(atoms: bigint, decimals: number, price: bigint): bigint`, `formatCents(cents: bigint): string`, `deviationBps(sold: Amount, received: Amount, price: bigint): number`, `formatBps(bps: number): string`, `type Amount = { atoms: bigint; decimals: number }`

- [ ] **Step 1: Add the dev dependency and type-check config**

Run: `pnpm add -D @types/bun`

Create `tsconfig.scripts.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "skipLibCheck": true,
    "types": ["bun"]
  },
  "include": ["scripts/quotes/**/*.ts", "tests/quotes/**/*.ts"]
}
```

In `tsconfig.json`, change `"exclude": ["node_modules", "build"]` to:

```json
  "exclude": ["node_modules", "build", "scripts/quotes", "tests/quotes"]
```

In `package.json` `scripts`, add:

```json
    "quotes:observe": "bun scripts/quotes/observe.ts",
    "quotes:report": "bun scripts/quotes/report.ts",
    "test:quotes": "bun test tests/quotes",
    "typecheck:scripts": "tsc --noEmit -p tsconfig.scripts.json",
```

and change `ci` to:

```json
    "ci": "npm run build && npm run lint && npm run format:check && npm run typecheck:scripts && npm run test:quotes",
```

- [ ] **Step 2: Write the constants**

Create `scripts/quotes/tokens.ts`:

```ts
/** Tokens the observer quotes, identified by verified mint (never by symbol). */
export type TrackedToken = { symbol: string; mint: string; decimals: number };

export const USDC = {
  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  decimals: 6,
} as const;

/** xStocks (Token-2022, 8 decimals), from the evidence appendix. */
export const TRACKED_TOKENS: readonly TrackedToken[] = [
  {
    symbol: "NVDAx",
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    decimals: 8,
  },
  {
    symbol: "TSLAx",
    mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    decimals: 8,
  },
  {
    symbol: "AAPLx",
    mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    decimals: 8,
  },
  {
    symbol: "METAx",
    mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    decimals: 8,
  },
  {
    symbol: "SPYx",
    mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    decimals: 8,
  },
];

/** Whole-dollar lot sizes quoted for every token. */
export const USD_LADDER: readonly bigint[] = [
  10_000n,
  50_000n,
  100_000n,
  250_000n,
  500_000n,
  1_000_000n,
];

/** The exact NVDAx quantity the Bidwall demo settles, in raw atoms. */
export const DEMO_LOT = { symbol: "NVDAx", atoms: 396_422_366n } as const;

/** Bounded slippage: Jupiter's minimum output is 0.5% below the quote. */
export const SLIPPAGE_BPS = 50;
```

- [ ] **Step 3: Write the failing unit tests**

Create `tests/quotes/units.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  atomsForUsd,
  centsForAtoms,
  deviationBps,
  formatBps,
  formatCents,
  parsePrice,
} from "../../scripts/quotes/units.ts";

describe("parsePrice", () => {
  test("converts a JSON price to 12-decimal fixed point", () => {
    expect(parsePrice(234.73351303753438)).toBe(234_733_513_037_534n);
    expect(parsePrice(100)).toBe(100_000_000_000_000n);
  });

  test("rejects prices that cannot be trusted", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e9]) {
      expect(() => parsePrice(bad)).toThrow("Unusable price");
    }
  });
});

describe("lot sizing", () => {
  test("rounds atoms down so the lot never exceeds the notional", () => {
    const nvdax = parsePrice(234.73351303753438);
    expect(atomsForUsd(10_000n, 8, nvdax)).toBe(4_260_150_104n);
    expect(atomsForUsd(1_000_000n, 8, nvdax)).toBe(426_015_010_408n);
  });

  test("values the demo lot in whole cents", () => {
    const price = parsePrice(234.4961011263661);
    expect(centsForAtoms(396_422_366n, 8, price)).toBe(92_959n);
    expect(formatCents(92_959n)).toBe("929.59");
    expect(formatCents(5n)).toBe("0.05");
  });
});

describe("deviationBps", () => {
  const usdc = (atoms: bigint) => ({ atoms, decimals: 6 });
  const token = (atoms: bigint) => ({ atoms, decimals: 8 });

  test("matches the live NVDAx demo-lot quote from 3 October", () => {
    const price = parsePrice(234.4961011263661);
    expect(deviationBps(token(396_422_366n), usdc(931_322_087n), price)).toBe(
      18
    );
  });

  test("is exact for round numbers and rounds toward negative infinity", () => {
    const price = parsePrice(100);
    expect(deviationBps(token(100_000_000n), usdc(99_000_000n), price)).toBe(
      -100
    );
    expect(deviationBps(token(100_000_000n), usdc(98_999_999n), price)).toBe(
      -101
    );
  });

  test("refuses a zero-sized sale", () => {
    expect(() => deviationBps(token(0n), usdc(1n), parsePrice(100))).toThrow(
      "zero"
    );
  });
});

describe("formatBps", () => {
  test("shows a signed percentage with a true minus sign", () => {
    expect(formatBps(18)).toBe("+0.18%");
    expect(formatBps(-3385)).toBe("−33.85%");
    expect(formatBps(0)).toBe("0.00%");
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `bun test tests/quotes/units.test.ts`
Expected: FAIL, cannot resolve `../../scripts/quotes/units.ts`.

- [ ] **Step 5: Implement `units.ts`**

Create `scripts/quotes/units.ts`:

```ts
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
  return (
    BigInt(whole) * PRICE_SCALE + BigInt(fraction.padEnd(PRICE_DECIMALS, "0"))
  );
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
```

- [ ] **Step 6: Run tests and type-check**

Run: `bun test tests/quotes/units.test.ts && npm run typecheck:scripts`
Expected: all tests PASS; `tsc` prints nothing.

- [ ] **Step 7: Format and commit**

```bash
npx prettier --write tsconfig.scripts.json scripts/quotes tests/quotes package.json tsconfig.json
git add tsconfig.scripts.json tsconfig.json package.json pnpm-lock.yaml scripts/quotes tests/quotes
git commit -m "feat: add fixed-point quote units and Bun script tooling"
```

---

### Task 2: Market session clock

**Files:**

- Create: `scripts/quotes/session.ts`, `tests/quotes/session.test.ts`

**Interfaces:**

- Produces: `SESSIONS` (readonly tuple in display order), `type Session`, `newYorkClock(at: Date): NewYorkClock`, `classifySession(at: Date): Session`, `type NewYorkClock = { date: string; weekday: number; minutes: number; label: string }`

- [ ] **Step 1: Write the failing tests**

Create `tests/quotes/session.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { classifySession, newYorkClock } from "../../scripts/quotes/session.ts";

const at = (iso: string) => classifySession(new Date(iso));

describe("classifySession", () => {
  test("regular hours open at 09:30 and close at 16:00 New York time", () => {
    expect(at("2026-10-05T13:29:59Z")).toBe("pre-market");
    expect(at("2026-10-05T13:30:00Z")).toBe("regular");
    expect(at("2026-10-05T19:59:59Z")).toBe("regular");
    expect(at("2026-10-05T20:00:00Z")).toBe("after-hours");
  });

  test("weeknight overnight runs from 20:00 to 04:00", () => {
    expect(at("2026-10-06T00:00:00Z")).toBe("overnight"); // Mon 20:00 EDT
    expect(at("2026-10-06T07:59:00Z")).toBe("overnight"); // Tue 03:59 EDT
    expect(at("2026-10-06T08:00:00Z")).toBe("pre-market"); // Tue 04:00 EDT
  });

  test("the weekend runs from Friday 20:00 to Monday 04:00", () => {
    expect(at("2026-10-09T23:59:00Z")).toBe("after-hours"); // Fri 19:59 EDT
    expect(at("2026-10-10T00:00:00Z")).toBe("weekend"); // Fri 20:00 EDT
    expect(at("2026-10-03T18:14:26Z")).toBe("weekend"); // Sat
    expect(at("2026-10-05T07:59:00Z")).toBe("weekend"); // Mon 03:59 EDT
    expect(at("2026-10-05T08:00:00Z")).toBe("pre-market"); // Mon 04:00 EDT
  });

  test("follows both 2026 daylight-saving changes", () => {
    expect(at("2026-03-09T13:30:00Z")).toBe("regular"); // 09:30 EDT
    expect(at("2026-11-02T14:29:00Z")).toBe("pre-market"); // 09:29 EST
    expect(at("2026-11-02T14:30:00Z")).toBe("regular"); // 09:30 EST
  });

  test("NYSE holidays are closed all day", () => {
    expect(at("2026-11-26T15:00:00Z")).toBe("holiday");
  });
});

describe("newYorkClock", () => {
  test("labels the local time and zone so a reader can check the session", () => {
    expect(newYorkClock(new Date("2026-10-03T18:14:26Z")).label).toBe(
      "2026-10-03 14:14 EDT"
    );
    expect(newYorkClock(new Date("2026-11-02T14:30:00Z")).label).toBe(
      "2026-11-02 09:30 EST"
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/quotes/session.test.ts`
Expected: FAIL, cannot resolve `session.ts`.

- [ ] **Step 3: Implement `session.ts`**

Create `scripts/quotes/session.ts`:

```ts
/** US equity market sessions, in the order reports display them. */
export const SESSIONS = [
  "weekend",
  "overnight",
  "pre-market",
  "regular",
  "after-hours",
  "holiday",
] as const;
export type Session = (typeof SESSIONS)[number];

/** NYSE full-day closures in 2026. */
const NYSE_HOLIDAYS_2026 = new Set([
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
]);

/** Minutes after midnight, New York time. */
const PRE_MARKET = 4 * 60;
const OPEN = 9 * 60 + 30;
const CLOSE = 16 * 60;
const AFTER_HOURS_END = 20 * 60;

const SUNDAY = 0;
const MONDAY = 1;
const FRIDAY = 5;
const SATURDAY = 6;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type NewYorkClock = {
  date: string; // YYYY-MM-DD
  weekday: number; // 0 = Sunday
  minutes: number; // since local midnight
  label: string; // "2026-10-03 14:14 EDT"
};

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});

export function newYorkClock(at: Date): NewYorkClock {
  const parts = formatter.formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((p) => p.type === type)?.value;
    if (value === undefined) throw new Error(`New York time has no ${type}`);
    return value;
  };
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const hour = part("hour");
  const minute = part("minute");
  return {
    date,
    weekday: WEEKDAYS.indexOf(part("weekday")),
    minutes: Number(hour) * 60 + Number(minute),
    label: `${date} ${hour}:${minute} ${part("timeZoneName")}`,
  };
}

export function classifySession(at: Date): Session {
  const { date, weekday, minutes } = newYorkClock(at);
  if (NYSE_HOLIDAYS_2026.has(date)) return "holiday";

  const isWeekend =
    weekday === SATURDAY ||
    weekday === SUNDAY ||
    (weekday === FRIDAY && minutes >= AFTER_HOURS_END) ||
    (weekday === MONDAY && minutes < PRE_MARKET);
  if (isWeekend) return "weekend";

  if (minutes < PRE_MARKET || minutes >= AFTER_HOURS_END) return "overnight";
  if (minutes < OPEN) return "pre-market";
  if (minutes < CLOSE) return "regular";
  return "after-hours";
}
```

- [ ] **Step 4: Run tests and type-check**

Run: `bun test tests/quotes/session.test.ts && npm run typecheck:scripts`
Expected: PASS; no type errors.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write scripts/quotes/session.ts tests/quotes/session.test.ts
git add scripts/quotes/session.ts tests/quotes/session.test.ts
git commit -m "feat: classify US market sessions in New York time"
```

---

### Task 3: Typed Jupiter client

**Files:**

- Create: `scripts/quotes/validate.ts`, `scripts/quotes/jupiter.ts`, `tests/quotes/fixtures.ts`, `tests/quotes/jupiter.test.ts`

**Interfaces:**

- Produces (`validate.ts`): `class ShapeError extends Error`, `readRecord(value: unknown, what: string): Record<string, unknown>`, `readString(obj, key): string`, `readNumber(obj, key): number`, `readOptionalNumber(obj, key): number | null`, `readIntegerString(obj, key): bigint`, `readArray(obj, key): unknown[]`
- Produces (`jupiter.ts`): `JUPITER_ENDPOINTS`, `type FetchLike = (url: string) => Promise<Response>`, `type Sleep = (ms: number) => Promise<void>`, `type RawExchange = { url: string; status: number | "network-error"; body: unknown }`, `type TokenInfo = { mint: string; symbol: string; decimals: number; usdPrice: number; priceBlockId: number | null; liquidityUsd: number | null }`, `type Quote = { inputMint: string; inAmount: bigint; outAmount: bigint; minOutAmount: bigint; priceImpactPct: string; contextSlot: number; routeLabels: string[] }`, `type QuoteRequest = { inputMint: string; outputMint: string; amount: bigint; slippageBps: number }`, `type TokensResult`, `type QuoteResult`, `createJupiterClient(options): JupiterClient`, `type JupiterClient = { getTokens(mints: readonly string[]): Promise<TokensResult>; getQuote(request: QuoteRequest): Promise<QuoteResult> }`
- `TokensResult = { status: "ok"; tokens: TokenInfo[]; exchange: RawExchange } | { status: "error"; error: string; exchange: RawExchange }`
- `QuoteResult = { status: "ok"; quote: Quote; exchange: RawExchange } | { status: "no-route"; exchange: RawExchange } | { status: "error"; error: string; exchange: RawExchange }`

- [ ] **Step 1: Write the shared test fixtures**

Create `tests/quotes/fixtures.ts`:

```ts
import type { FetchLike, Sleep } from "../../scripts/quotes/jupiter.ts";
import { USDC } from "../../scripts/quotes/tokens.ts";

export const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";

/** Shape of a Jupiter token API entry (fields we read, plus realistic extras). */
export function tokenEntry(
  mint: string,
  symbol: string,
  usdPrice: number,
  decimals = 8
) {
  return {
    id: mint,
    symbol,
    name: `${symbol} xStock`,
    decimals,
    usdPrice,
    priceBlockId: 453_011_061,
    liquidity: 4_707_750.48,
    tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  };
}

/** Shape of a Jupiter quote, modelled on the live NVDAx demo-lot response of 3 October. */
export function quoteBody(
  inputMint: string,
  inAmount: bigint,
  outAmount: bigint
) {
  return {
    inputMint,
    inAmount: inAmount.toString(),
    outputMint: USDC.mint,
    outAmount: outAmount.toString(),
    otherAmountThreshold: ((outAmount * 995n) / 1000n).toString(),
    swapMode: "ExactIn",
    slippageBps: 50,
    priceImpactPct: "0.0002658460553391063286039473",
    routePlan: [
      {
        swapInfo: {
          ammKey: "GxGxQBvMQ7vUZWRM6v26umC9w8bCxu4hXTHxCtgEcopa",
          label: "Riptide",
          inputMint,
          outputMint: USDC.mint,
          inAmount: inAmount.toString(),
          outAmount: outAmount.toString(),
        },
        percent: 100,
      },
    ],
    contextSlot: 452_986_050,
    timeTaken: 0.0117,
  };
}

export const NO_ROUTE = {
  error: "No routes found",
  errorCode: "NO_ROUTES_FOUND",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fake fetch that answers from `handler` and records every URL requested. */
export function fakeFetch(handler: (url: URL) => Response | Promise<Response>) {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    return handler(new URL(url));
  };
  return { fetch, calls };
}

/** A sleep that returns immediately and records requested delays. */
export function recordingSleep() {
  const delays: number[] = [];
  const sleep: Sleep = async (ms) => {
    delays.push(ms);
  };
  return { sleep, delays };
}
```

- [ ] **Step 2: Write the failing client tests**

Create `tests/quotes/jupiter.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createJupiterClient } from "../../scripts/quotes/jupiter.ts";
import { USDC } from "../../scripts/quotes/tokens.ts";
import {
  NO_ROUTE,
  NVDAX,
  fakeFetch,
  json,
  quoteBody,
  recordingSleep,
  tokenEntry,
} from "./fixtures.ts";

const request = {
  inputMint: NVDAX,
  outputMint: USDC.mint,
  amount: 396_422_366n,
  slippageBps: 50,
};

function client(handler: Parameters<typeof fakeFetch>[0]) {
  const http = fakeFetch(handler);
  const pause = recordingSleep();
  return {
    ...http,
    delays: pause.delays,
    jupiter: createJupiterClient({ fetch: http.fetch, sleep: pause.sleep }),
  };
}

describe("getQuote", () => {
  test("parses the live demo-lot quote into exact amounts", async () => {
    const { jupiter, calls } = client(() =>
      json(quoteBody(NVDAX, 396_422_366n, 931_322_087n))
    );
    const result = await jupiter.getQuote(request);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.quote).toEqual({
      inputMint: NVDAX,
      inAmount: 396_422_366n,
      outAmount: 931_322_087n,
      minOutAmount: 926_665_476n,
      priceImpactPct: "0.0002658460553391063286039473",
      contextSlot: 452_986_050,
      routeLabels: ["Riptide"],
    });
    const url = new URL(calls[0] ?? "");
    expect(url.searchParams.get("amount")).toBe("396422366");
    expect(url.searchParams.get("slippageBps")).toBe("50");
    expect(url.searchParams.get("outputMint")).toBe(USDC.mint);
  });

  test("reports no route without retrying", async () => {
    const { jupiter, calls } = client(() => json(NO_ROUTE, 400));
    expect((await jupiter.getQuote(request)).status).toBe("no-route");
    expect(calls).toHaveLength(1);
  });

  test("reports other client errors with Jupiter's message, without retrying", async () => {
    const { jupiter, calls } = client(() =>
      json({ error: "Invalid amount" }, 400)
    );
    const result = await jupiter.getQuote(request);
    expect(result).toMatchObject({
      status: "error",
      error: "HTTP 400: Invalid amount",
    });
    expect(calls).toHaveLength(1);
  });

  test("retries once after a rate limit", async () => {
    let attempts = 0;
    const { jupiter, calls, delays } = client(() =>
      ++attempts === 1
        ? json({ error: "Too many requests" }, 429)
        : json(quoteBody(NVDAX, 1n, 2n))
    );
    expect((await jupiter.getQuote(request)).status).toBe("ok");
    expect(calls).toHaveLength(2);
    expect(delays).toEqual([3_000]);
  });

  test("gives up after a second server error", async () => {
    const { jupiter, calls } = client(() =>
      json({ error: "Unavailable" }, 503)
    );
    expect(await jupiter.getQuote(request)).toMatchObject({
      status: "error",
      error: "HTTP 503: Unavailable",
    });
    expect(calls).toHaveLength(2);
  });

  test("retries once when fetch itself throws, then records the failure", async () => {
    const { jupiter, calls } = client(() => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    const result = await jupiter.getQuote(request);
    expect(result).toMatchObject({
      status: "error",
      error: "Network error: getaddrinfo ENOTFOUND",
    });
    expect(result.exchange.status).toBe("network-error");
    expect(calls).toHaveLength(2);
  });

  test("rejects a 200 response with a missing amount instead of guessing", async () => {
    const body: Record<string, unknown> = quoteBody(NVDAX, 1n, 2n);
    delete body.outAmount;
    const { jupiter } = client(() => json(body));
    expect(await jupiter.getQuote(request)).toMatchObject({
      status: "error",
      error: "Unexpected quote response: outAmount must be an integer string",
    });
  });
});

describe("getTokens", () => {
  const SPYX = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";

  test("looks up every mint in one request and keeps only requested mints", async () => {
    const { jupiter, calls } = client(() =>
      json([
        tokenEntry(NVDAX, "NVDAx", 234.5),
        { id: "SomeOtherMint", symbol: "JUNK", usdPrice: "not a number" },
        tokenEntry(SPYX, "SPYx", 770.86),
      ])
    );
    const result = await jupiter.getTokens([NVDAX, SPYX]);

    expect(new URL(calls[0] ?? "").searchParams.get("query")).toBe(
      `${NVDAX},${SPYX}`
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.tokens.map((t) => t.mint)).toEqual([NVDAX, SPYX]);
    expect(result.tokens[0]).toEqual({
      mint: NVDAX,
      symbol: "NVDAx",
      decimals: 8,
      usdPrice: 234.5,
      priceBlockId: 453_011_061,
      liquidityUsd: 4_707_750.48,
    });
  });

  test("fails the lookup when a requested token is malformed", async () => {
    const { jupiter } = client(() =>
      json([{ ...tokenEntry(NVDAX, "NVDAx", 1), usdPrice: "234.5" }])
    );
    expect(await jupiter.getTokens([NVDAX])).toMatchObject({
      status: "error",
      error: "Unexpected token response: usdPrice must be a finite number",
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/quotes/jupiter.test.ts`
Expected: FAIL, cannot resolve `jupiter.ts`.

- [ ] **Step 4: Implement the validators**

Create `scripts/quotes/validate.ts`:

```ts
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
```

- [ ] **Step 5: Implement the client**

Create `scripts/quotes/jupiter.ts`:

```ts
import {
  ShapeError,
  readArray,
  readIntegerString,
  readNumber,
  readOptionalNumber,
  readRecord,
  readString,
} from "./validate.ts";

/** Jupiter's free endpoints. Quotes only: nothing here builds or sends a swap. */
export const JUPITER_ENDPOINTS = {
  quote: "https://lite-api.jup.ag/swap/v1/quote",
  tokens: "https://lite-api.jup.ag/tokens/v2/search",
} as const;

const RETRY_DELAY_MS = 3_000;
const NO_ROUTE_CODES = new Set(["NO_ROUTES_FOUND", "COULD_NOT_FIND_ANY_ROUTE"]);

export type FetchLike = (url: string) => Promise<Response>;
export type Sleep = (ms: number) => Promise<void>;

/** One HTTP request and its response, kept verbatim as evidence. */
export type RawExchange = {
  url: string;
  status: number | "network-error";
  body: unknown;
};

export type TokenInfo = {
  mint: string;
  symbol: string;
  decimals: number;
  usdPrice: number;
  priceBlockId: number | null;
  liquidityUsd: number | null;
};

export type Quote = {
  inputMint: string;
  inAmount: bigint;
  outAmount: bigint;
  minOutAmount: bigint;
  priceImpactPct: string;
  contextSlot: number;
  routeLabels: string[];
};

export type QuoteRequest = {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  slippageBps: number;
};

export type TokensResult =
  | { status: "ok"; tokens: TokenInfo[]; exchange: RawExchange }
  | { status: "error"; error: string; exchange: RawExchange };

export type QuoteResult =
  | { status: "ok"; quote: Quote; exchange: RawExchange }
  | { status: "no-route"; exchange: RawExchange }
  | { status: "error"; error: string; exchange: RawExchange };

export type JupiterClient = {
  getTokens(mints: readonly string[]): Promise<TokensResult>;
  getQuote(request: QuoteRequest): Promise<QuoteResult>;
};

export function createJupiterClient(options: {
  fetch: FetchLike;
  sleep: Sleep;
  retryDelayMs?: number;
}): JupiterClient {
  const { fetch, sleep, retryDelayMs = RETRY_DELAY_MS } = options;

  async function attempt(url: string): Promise<RawExchange> {
    try {
      const response = await fetch(url);
      const text = await response.text();
      return { url, status: response.status, body: parseJson(text) };
    } catch (error) {
      return { url, status: "network-error", body: errorMessage(error) };
    }
  }

  /** Retries once on rate limits, server errors and network failures. */
  async function request(url: string): Promise<RawExchange> {
    const first = await attempt(url);
    if (!isRetryable(first.status)) return first;
    await sleep(retryDelayMs);
    return attempt(url);
  }

  return {
    async getTokens(mints) {
      const url = `${JUPITER_ENDPOINTS.tokens}?query=${mints.join(",")}`;
      const exchange = await request(url);
      if (exchange.status !== 200)
        return { status: "error", error: describeFailure(exchange), exchange };
      try {
        if (!Array.isArray(exchange.body))
          throw new ShapeError("body must be an array");
        const requested = exchange.body.filter((entry) =>
          mints.includes(idOf(entry))
        );
        return { status: "ok", tokens: requested.map(parseToken), exchange };
      } catch (error) {
        return {
          status: "error",
          error: `Unexpected token response: ${errorMessage(error)}`,
          exchange,
        };
      }
    },

    async getQuote({ inputMint, outputMint, amount, slippageBps }) {
      const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount: amount.toString(),
        slippageBps: slippageBps.toString(),
      });
      const exchange = await request(`${JUPITER_ENDPOINTS.quote}?${params}`);
      if (exchange.status === 200) {
        try {
          return { status: "ok", quote: parseQuote(exchange.body), exchange };
        } catch (error) {
          return {
            status: "error",
            error: `Unexpected quote response: ${errorMessage(error)}`,
            exchange,
          };
        }
      }
      if (
        exchange.status === 400 &&
        NO_ROUTE_CODES.has(fieldOf(exchange.body, "errorCode"))
      )
        return { status: "no-route", exchange };
      return { status: "error", error: describeFailure(exchange), exchange };
    },
  };
}

function parseToken(value: unknown): TokenInfo {
  const token = readRecord(value, "token");
  return {
    mint: readString(token, "id"),
    symbol: readString(token, "symbol"),
    decimals: readNumber(token, "decimals"),
    usdPrice: readNumber(token, "usdPrice"),
    priceBlockId: readOptionalNumber(token, "priceBlockId"),
    liquidityUsd: readOptionalNumber(token, "liquidity"),
  };
}

function parseQuote(value: unknown): Quote {
  const quote = readRecord(value, "quote");
  return {
    inputMint: readString(quote, "inputMint"),
    inAmount: readIntegerString(quote, "inAmount"),
    outAmount: readIntegerString(quote, "outAmount"),
    minOutAmount: readIntegerString(quote, "otherAmountThreshold"),
    priceImpactPct: readString(quote, "priceImpactPct"),
    contextSlot: readNumber(quote, "contextSlot"),
    routeLabels: readArray(quote, "routePlan").map((step) =>
      readString(
        readRecord(readRecord(step, "route step").swapInfo, "swapInfo"),
        "label"
      )
    ),
  };
}

function isRetryable(status: RawExchange["status"]): boolean {
  return status === "network-error" || status === 429 || status >= 500;
}

function describeFailure(exchange: RawExchange): string {
  if (exchange.status === "network-error")
    return `Network error: ${String(exchange.body)}`;
  const detail = fieldOf(exchange.body, "error");
  return detail
    ? `HTTP ${exchange.status}: ${detail}`
    : `HTTP ${exchange.status}`;
}

/** A string field of an object body, or "" when absent. */
function fieldOf(body: unknown, key: string): string {
  if (typeof body !== "object" || body === null) return "";
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

const idOf = (entry: unknown) => fieldOf(entry, "id");

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 6: Run tests and type-check**

Run: `bun test tests/quotes/jupiter.test.ts && npm run typecheck:scripts`
Expected: PASS; no type errors.

- [ ] **Step 7: Format and commit**

```bash
npx prettier --write scripts/quotes tests/quotes
git add scripts/quotes/validate.ts scripts/quotes/jupiter.ts tests/quotes/fixtures.ts tests/quotes/jupiter.test.ts
git commit -m "feat: add typed Jupiter quote and token client"
```

---

### Task 4: Build one observation

**Files:**

- Create: `scripts/quotes/types.ts`, `scripts/quotes/observe.ts`, `tests/quotes/observe.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 1–3.
- Produces (`types.ts`): `type Runner = "github-actions" | "local"`, `type Lot = "demo-lot" | \`usd-${number}\``, `type QuoteObservation`, `type TokenObservation`, `type ObservationDraft`(stored record without`raw`), `type Observation = ObservationDraft & { raw: { path: string; sha256: string } }`
- Produces (`observe.ts`): `runObservation(deps: ObserveDeps): Promise<{ observation: ObservationDraft; exchanges: RawExchange[] }>`, `type ObserveDeps = { client: JupiterClient; now: Date; runner: Runner; pause: () => Promise<void> }`, `countOkQuotes(observation: ObservationDraft): number`

- [ ] **Step 1: Write the record types**

Create `scripts/quotes/types.ts`:

```ts
import type { JUPITER_ENDPOINTS } from "./jupiter.ts";
import type { Session } from "./session.ts";

/** The stored schema. Bigints are serialized as decimal strings. */
export type Runner = "github-actions" | "local";
export type Lot = "demo-lot" | `usd-${number}`;

export type QuoteObservation = {
  lot: Lot;
  inAmountRaw: string;
  notionalUsd: string; // value of the lot at the reference price, in dollars
  status: "ok" | "no-route" | "error";
  error?: string;
  outAmountRaw?: string;
  minOutAmountRaw?: string; // Jupiter's otherAmountThreshold
  deviationBps?: number;
  priceImpactPct?: string;
  contextSlot?: number;
  routeLabels?: string[];
};

export type TokenObservation = {
  symbol: string;
  mint: string;
  decimals: number;
  status: "ok" | "skipped";
  skipReason?: string;
  referencePriceUsd?: string;
  priceBlockId?: number | null;
  liquidityUsd?: string | null;
  quotes: QuoteObservation[];
};

export type ObservationDraft = {
  schema: "bidwall.quote-observation/v1";
  label: "Mainnet Jupiter quote, not executed";
  observedAt: string;
  newYorkTime: string;
  session: Session;
  runner: Runner;
  slippageBps: number;
  endpoints: typeof JUPITER_ENDPOINTS;
  tokens: TokenObservation[];
};

export type Observation = ObservationDraft & {
  raw: { path: string; sha256: string };
};
```

- [ ] **Step 2: Write the failing tests**

Create `tests/quotes/observe.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createJupiterClient } from "../../scripts/quotes/jupiter.ts";
import { countOkQuotes, runObservation } from "../../scripts/quotes/observe.ts";
import { TRACKED_TOKENS } from "../../scripts/quotes/tokens.ts";
import {
  NO_ROUTE,
  fakeFetch,
  json,
  quoteBody,
  recordingSleep,
  tokenEntry,
} from "./fixtures.ts";

const SATURDAY = new Date("2026-10-03T18:14:26Z");
type Overrides = {
  decimals?: Record<string, number>;
  price?: Record<string, number>;
  omit?: string[];
};

/**
 * Every token is priced at $100, so a lot's USDC value in atoms equals its
 * token atoms. Quotes answer 1% below that value unless a test says otherwise.
 */
function market(
  overrides: Overrides = {},
  answer?: (url: URL, inAmount: bigint) => Response
) {
  const http = fakeFetch((url) => {
    if (url.pathname.includes("/tokens/"))
      return json(
        TRACKED_TOKENS.filter((t) => !overrides.omit?.includes(t.symbol)).map(
          (t) =>
            tokenEntry(
              t.mint,
              t.symbol,
              overrides.price?.[t.symbol] ?? 100,
              overrides.decimals?.[t.symbol] ?? 8
            )
        )
      );
    const inAmount = BigInt(url.searchParams.get("amount") ?? "0");
    if (answer) return answer(url, inAmount);
    return json(
      quoteBody(
        url.searchParams.get("inputMint") ?? "",
        inAmount,
        (inAmount * 99n) / 100n
      )
    );
  });
  const client = createJupiterClient({
    fetch: http.fetch,
    sleep: recordingSleep().sleep,
  });
  const observe = () =>
    runObservation({
      client,
      now: SATURDAY,
      runner: "local",
      pause: async () => {},
    });
  return { observe, calls: http.calls };
}

const token = (observation: { tokens: { symbol: string }[] }, symbol: string) =>
  observation.tokens.find((t) => t.symbol === symbol);

describe("runObservation", () => {
  test("quotes the demo lot and the dollar ladder for every token", async () => {
    const { observe, calls } = market();
    const { observation, exchanges } = await observe();

    expect(observation).toMatchObject({
      schema: "bidwall.quote-observation/v1",
      label: "Mainnet Jupiter quote, not executed",
      observedAt: "2026-10-03T18:14:26.000Z",
      newYorkTime: "2026-10-03 14:14 EDT",
      session: "weekend",
      runner: "local",
      slippageBps: 50,
    });
    expect(calls).toHaveLength(32);
    expect(exchanges).toHaveLength(32);
    expect(countOkQuotes(observation)).toBe(31);

    const nvdax = token(observation, "NVDAx");
    expect(nvdax?.quotes.map((q) => q.lot)).toEqual([
      "demo-lot",
      "usd-10000",
      "usd-50000",
      "usd-100000",
      "usd-250000",
      "usd-500000",
      "usd-1000000",
    ]);
    expect(nvdax?.quotes[0]).toMatchObject({
      inAmountRaw: "396422366",
      notionalUsd: "396.42",
      status: "ok",
      outAmountRaw: "392458142",
      deviationBps: -101, // 0.99 × 396422366 is floored, so it is a hair under 1%
      routeLabels: ["Riptide"],
    });
    expect(nvdax?.quotes[1]).toMatchObject({
      inAmountRaw: "10000000000",
      notionalUsd: "10000.00",
    });
    expect(token(observation, "SPYx")?.quotes).toHaveLength(6);
  });

  test("skips a token whose decimals disagree with the allowlist", async () => {
    const { observe, calls } = market({ decimals: { TSLAx: 6 } });
    const { observation } = await observe();
    expect(token(observation, "TSLAx")).toMatchObject({
      status: "skipped",
      skipReason: "Token API reports 6 decimals, expected 8",
      quotes: [],
    });
    expect(calls).toHaveLength(26);
  });

  test("skips a token the token API did not return", async () => {
    const { observe } = market({ omit: ["METAx"] });
    const { observation } = await observe();
    expect(token(observation, "METAx")).toMatchObject({
      status: "skipped",
      skipReason: "Not returned by the token API",
    });
  });

  test("skips a token with an unusable reference price", async () => {
    const { observe } = market({ price: { AAPLx: 0 } });
    const { observation } = await observe();
    expect(token(observation, "AAPLx")).toMatchObject({
      status: "skipped",
      skipReason: "Unusable price: 0",
    });
  });

  test("never records a quote that does not echo the request", async () => {
    const { observe } = market({}, (url, inAmount) =>
      json(
        quoteBody(
          url.searchParams.get("inputMint") ?? "",
          inAmount + 1n,
          inAmount
        )
      )
    );
    const { observation } = await observe();
    expect(token(observation, "NVDAx")?.quotes[0]).toMatchObject({
      status: "error",
      error:
        "Quote does not match the request (asked 396422366, quoted 396422367)",
    });
    expect(countOkQuotes(observation)).toBe(0);
  });

  test("records no-route quotes and keeps going", async () => {
    const { observe } = market({}, () => json(NO_ROUTE, 400));
    const { observation } = await observe();
    expect(
      token(observation, "SPYx")?.quotes.every((q) => q.status === "no-route")
    ).toBe(true);
  });

  test("skips every token when the token lookup fails", async () => {
    const http = fakeFetch(() => json({ error: "Unavailable" }, 500));
    const client = createJupiterClient({
      fetch: http.fetch,
      sleep: recordingSleep().sleep,
    });
    const { observation } = await runObservation({
      client,
      now: SATURDAY,
      runner: "local",
      pause: async () => {},
    });
    expect(
      observation.tokens.every(
        (t) => t.skipReason === "Token lookup failed: HTTP 500: Unavailable"
      )
    ).toBe(true);
    expect(countOkQuotes(observation)).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/quotes/observe.test.ts`
Expected: FAIL, cannot resolve `observe.ts`.

- [ ] **Step 4: Implement `observe.ts` (library part)**

Create `scripts/quotes/observe.ts`:

```ts
import type {
  JupiterClient,
  QuoteResult,
  RawExchange,
  TokenInfo,
  TokensResult,
} from "./jupiter.ts";
import { JUPITER_ENDPOINTS } from "./jupiter.ts";
import { classifySession, newYorkClock } from "./session.ts";
import {
  DEMO_LOT,
  SLIPPAGE_BPS,
  TRACKED_TOKENS,
  USD_LADDER,
  USDC,
  type TrackedToken,
} from "./tokens.ts";
import type {
  Lot,
  ObservationDraft,
  QuoteObservation,
  Runner,
  TokenObservation,
} from "./types.ts";
import {
  atomsForUsd,
  centsForAtoms,
  deviationBps,
  formatCents,
  parsePrice,
} from "./units.ts";

export type ObserveDeps = {
  client: JupiterClient;
  now: Date;
  runner: Runner;
  /** Called before each quote request to pace traffic. */
  pause: () => Promise<void>;
};

type PlannedLot = { lot: Lot; atoms: bigint };

/** Quotes every tracked token once and returns the record plus every raw exchange. */
export async function runObservation(deps: ObserveDeps) {
  const exchanges: RawExchange[] = [];
  const lookup = await deps.client.getTokens(TRACKED_TOKENS.map((t) => t.mint));
  exchanges.push(lookup.exchange);

  const tokens: TokenObservation[] = [];
  for (const tracked of TRACKED_TOKENS) {
    tokens.push(await observeToken(tracked, lookup, deps, exchanges));
  }

  const observation: ObservationDraft = {
    schema: "bidwall.quote-observation/v1",
    label: "Mainnet Jupiter quote, not executed",
    observedAt: deps.now.toISOString(),
    newYorkTime: newYorkClock(deps.now).label,
    session: classifySession(deps.now),
    runner: deps.runner,
    slippageBps: SLIPPAGE_BPS,
    endpoints: JUPITER_ENDPOINTS,
    tokens,
  };
  return { observation, exchanges };
}

export function countOkQuotes(observation: ObservationDraft): number {
  return observation.tokens
    .flatMap((t) => t.quotes)
    .filter((q) => q.status === "ok").length;
}

async function observeToken(
  tracked: TrackedToken,
  lookup: TokensResult,
  deps: ObserveDeps,
  exchanges: RawExchange[]
): Promise<TokenObservation> {
  const skip = (skipReason: string): TokenObservation => ({
    ...tracked,
    status: "skipped",
    skipReason,
    quotes: [],
  });

  if (lookup.status === "error")
    return skip(`Token lookup failed: ${lookup.error}`);
  const info = lookup.tokens.find((t) => t.mint === tracked.mint);
  if (!info) return skip("Not returned by the token API");
  if (info.decimals !== tracked.decimals)
    return skip(
      `Token API reports ${info.decimals} decimals, expected ${tracked.decimals}`
    );

  let price: bigint;
  try {
    price = parsePrice(info.usdPrice);
  } catch (error) {
    return skip(error instanceof Error ? error.message : String(error));
  }

  const quotes: QuoteObservation[] = [];
  for (const planned of plannedLots(tracked, price)) {
    await deps.pause();
    const result = await deps.client.getQuote({
      inputMint: tracked.mint,
      outputMint: USDC.mint,
      amount: planned.atoms,
      slippageBps: SLIPPAGE_BPS,
    });
    exchanges.push(result.exchange);
    quotes.push(toQuoteObservation(tracked, price, planned, result));
  }
  return { ...tracked, status: "ok", ...referenceOf(info), quotes };
}

/** The demo lot (NVDAx only) followed by the dollar ladder. */
function plannedLots(tracked: TrackedToken, price: bigint): PlannedLot[] {
  const ladder = USD_LADDER.map((usd): PlannedLot => ({
    lot: `usd-${Number(usd)}`,
    atoms: atomsForUsd(usd, tracked.decimals, price),
  }));
  return tracked.symbol === DEMO_LOT.symbol
    ? [{ lot: "demo-lot", atoms: DEMO_LOT.atoms }, ...ladder]
    : ladder;
}

function toQuoteObservation(
  tracked: TrackedToken,
  price: bigint,
  planned: PlannedLot,
  result: QuoteResult
): QuoteObservation {
  const base = {
    lot: planned.lot,
    inAmountRaw: planned.atoms.toString(),
    notionalUsd: formatCents(
      centsForAtoms(planned.atoms, tracked.decimals, price)
    ),
  };
  if (result.status === "no-route") return { ...base, status: "no-route" };
  if (result.status === "error")
    return { ...base, status: "error", error: result.error };

  const { quote } = result;
  if (quote.inputMint !== tracked.mint || quote.inAmount !== planned.atoms)
    return {
      ...base,
      status: "error",
      error: `Quote does not match the request (asked ${planned.atoms}, quoted ${quote.inAmount})`,
    };

  return {
    ...base,
    status: "ok",
    outAmountRaw: quote.outAmount.toString(),
    minOutAmountRaw: quote.minOutAmount.toString(),
    deviationBps: deviationBps(
      { atoms: planned.atoms, decimals: tracked.decimals },
      { atoms: quote.outAmount, decimals: USDC.decimals },
      price
    ),
    priceImpactPct: quote.priceImpactPct,
    contextSlot: quote.contextSlot,
    routeLabels: quote.routeLabels,
  };
}

function referenceOf(info: TokenInfo) {
  return {
    referencePriceUsd: String(info.usdPrice),
    priceBlockId: info.priceBlockId,
    liquidityUsd: info.liquidityUsd === null ? null : String(info.liquidityUsd),
  };
}
```

- [ ] **Step 5: Run tests and type-check**

Run: `bun test tests/quotes && npm run typecheck:scripts`
Expected: all quote tests PASS; no type errors.

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write scripts/quotes tests/quotes
git add scripts/quotes/types.ts scripts/quotes/observe.ts tests/quotes/observe.test.ts
git commit -m "feat: build verified quote observations for tracked xStocks"
```

---

### Task 5: Storage and the observe command

**Files:**

- Create: `scripts/quotes/store.ts`, `tests/quotes/store.test.ts`
- Modify: `scripts/quotes/observe.ts` (append CLI entry point)

**Interfaces:**

- Consumes: `ObservationDraft`, `Observation` (Task 4), `RawExchange` (Task 3).
- Produces: `rawFileName(observedAt: string): string`, `saveObservation(dir: string, draft: ObservationDraft, exchanges: RawExchange[]): Observation`

- [ ] **Step 1: Write the failing tests**

Create `tests/quotes/store.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { rawFileName, saveObservation } from "../../scripts/quotes/store.ts";
import type { ObservationDraft } from "../../scripts/quotes/types.ts";
import { JUPITER_ENDPOINTS } from "../../scripts/quotes/jupiter.ts";

function draft(observedAt: string): ObservationDraft {
  return {
    schema: "bidwall.quote-observation/v1",
    label: "Mainnet Jupiter quote, not executed",
    observedAt,
    newYorkTime: "2026-10-03 14:14 EDT",
    session: "weekend",
    runner: "local",
    slippageBps: 50,
    endpoints: JUPITER_ENDPOINTS,
    tokens: [],
  };
}

const exchanges = [
  { url: "https://example.test/q", status: 200, body: { outAmount: "1" } },
];

describe("saveObservation", () => {
  test("writes gzip raw evidence and a hashed summary line", () => {
    const dir = mkdtempSync(join(tmpdir(), "quotes-"));
    const saved = saveObservation(
      dir,
      draft("2026-10-03T18:14:26.123Z"),
      exchanges
    );

    expect(saved.raw.path).toBe("raw/2026-10-03T18-14-26Z.json.gz");
    const rawBytes = readFileSync(join(dir, saved.raw.path));
    expect(saved.raw.sha256).toBe(
      createHash("sha256").update(rawBytes).digest("hex")
    );
    expect(JSON.parse(gunzipSync(rawBytes).toString())).toEqual({
      observedAt: "2026-10-03T18:14:26.123Z",
      exchanges,
    });

    const lines = readFileSync(join(dir, "2026-10-03.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual(saved);
  });

  test("appends to the day's file and starts a new file each UTC day", () => {
    const dir = mkdtempSync(join(tmpdir(), "quotes-"));
    saveObservation(dir, draft("2026-10-03T22:07:00.000Z"), exchanges);
    saveObservation(dir, draft("2026-10-03T23:07:00.000Z"), exchanges);
    saveObservation(dir, draft("2026-10-04T00:07:00.000Z"), exchanges);

    expect(
      readFileSync(join(dir, "2026-10-03.jsonl"), "utf8").trim().split("\n")
    ).toHaveLength(2);
    expect(
      readFileSync(join(dir, "2026-10-04.jsonl"), "utf8").trim().split("\n")
    ).toHaveLength(1);
    expect(readdirSync(join(dir, "raw"))).toHaveLength(3);
  });
});

test("rawFileName drops milliseconds and colons", () => {
  expect(rawFileName("2026-10-03T18:14:26.123Z")).toBe(
    "2026-10-03T18-14-26Z.json.gz"
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/quotes/store.test.ts`
Expected: FAIL, cannot resolve `store.ts`.

- [ ] **Step 3: Implement `store.ts`**

Create `scripts/quotes/store.ts`:

```ts
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { RawExchange } from "./jupiter.ts";
import type { Observation, ObservationDraft } from "./types.ts";

/** "2026-10-03T18:14:26.123Z" becomes "2026-10-03T18-14-26Z.json.gz". */
export function rawFileName(observedAt: string): string {
  return `${observedAt.slice(0, 19).replaceAll(":", "-")}Z.json.gz`;
}

/**
 * Writes the raw exchanges as gzip evidence, then appends the summary line
 * (with the raw file's path and SHA-256) to that UTC day's JSONL file.
 */
export function saveObservation(
  dir: string,
  draft: ObservationDraft,
  exchanges: RawExchange[]
): Observation {
  const rawPath = join("raw", rawFileName(draft.observedAt));
  const rawBytes = gzipSync(
    JSON.stringify({ observedAt: draft.observedAt, exchanges })
  );
  mkdirSync(join(dir, "raw"), { recursive: true });
  writeFileSync(join(dir, rawPath), rawBytes);

  const observation: Observation = {
    ...draft,
    raw: {
      path: rawPath,
      sha256: createHash("sha256").update(rawBytes).digest("hex"),
    },
  };
  appendFileSync(
    join(dir, `${draft.observedAt.slice(0, 10)}.jsonl`),
    `${JSON.stringify(observation)}\n`
  );
  return observation;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/quotes/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the CLI entry point to `observe.ts`**

Add these imports to the top of `scripts/quotes/observe.ts`:

```ts
import { parseArgs } from "node:util";
import { createJupiterClient } from "./jupiter.ts";
import { saveObservation } from "./store.ts";
```

(merge `createJupiterClient` into the existing `./jupiter.ts` value import alongside `JUPITER_ENDPOINTS`), then append to the end of the file:

```ts
const PAUSE_MS = 1_000;
const USAGE =
  "Usage: bun scripts/quotes/observe.ts --out <data dir> [--runner local|github-actions]";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function parseRunner(value: string | undefined): Runner {
  if (value === "local" || value === "github-actions") return value;
  throw new Error(`Unknown runner "${value}". ${USAGE}`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      runner: { type: "string", default: "local" },
    },
  });
  if (!values.out) throw new Error(USAGE);

  const client = createJupiterClient({
    fetch: (url) => fetch(url, { headers: { accept: "application/json" } }),
    sleep,
  });
  const { observation, exchanges } = await runObservation({
    client,
    now: new Date(),
    runner: parseRunner(values.runner),
    pause: () => sleep(PAUSE_MS),
  });
  const saved = saveObservation(values.out, observation, exchanges);

  console.log(
    `${saved.observedAt} (${saved.session}, ${saved.newYorkTime}) -> ${saved.raw.path}`
  );
  for (const token of saved.tokens) {
    const ok = token.quotes.filter((q) => q.status === "ok").length;
    console.log(
      `  ${token.symbol}: ${token.skipReason ?? `${ok}/${token.quotes.length} quotes ok`}`
    );
  }
  if (countOkQuotes(saved) === 0) {
    console.error("No quote succeeded in this run.");
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
```

- [ ] **Step 6: Run the whole suite, type-check, then one live run**

Run: `bun test tests/quotes && npm run typecheck:scripts`
Expected: PASS; no type errors.

Run: `bun scripts/quotes/observe.ts --out /tmp/bidwall-quotes`
Expected: about 40 seconds, then a header line with `weekend` (or the current session) and five token lines, most reading `7/7` or `6/6 quotes ok`. Inspect: `head -c 600 /tmp/bidwall-quotes/*.jsonl` shows the schema and label.

- [ ] **Step 7: Format and commit**

```bash
npx prettier --write scripts/quotes tests/quotes
git add scripts/quotes/store.ts scripts/quotes/observe.ts tests/quotes/store.test.ts
git commit -m "feat: store quote observations as hashed gzip evidence"
```

---

### Task 6: Summary report

**Files:**

- Create: `scripts/quotes/report.ts`, `tests/quotes/report.test.ts`

**Interfaces:**

- Consumes: `Observation` (Task 4), `SESSIONS`, `Session` (Task 2), `formatBps` (Task 1).
- Produces: `readObservations(dir: string): Observation[]`, `renderReport(observations: readonly Observation[]): string`

- [ ] **Step 1: Write the failing tests**

Create `tests/quotes/report.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JUPITER_ENDPOINTS } from "../../scripts/quotes/jupiter.ts";
import { readObservations, renderReport } from "../../scripts/quotes/report.ts";
import type { Session } from "../../scripts/quotes/session.ts";
import type {
  Observation,
  QuoteObservation,
} from "../../scripts/quotes/types.ts";

function observation(
  observedAt: string,
  session: Session,
  quote: Partial<QuoteObservation>
): Observation {
  return {
    schema: "bidwall.quote-observation/v1",
    label: "Mainnet Jupiter quote, not executed",
    observedAt,
    newYorkTime: "",
    session,
    runner: "local",
    slippageBps: 50,
    endpoints: JUPITER_ENDPOINTS,
    tokens: [
      {
        symbol: "NVDAx",
        mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
        decimals: 8,
        status: "ok",
        quotes: [
          {
            lot: "demo-lot",
            inAmountRaw: "1",
            notionalUsd: "1.00",
            status: "ok",
            ...quote,
          },
        ],
      },
    ],
    raw: { path: "", sha256: "" },
  };
}

const series = [
  observation("2026-10-03T19:07:00.000Z", "weekend", { deviationBps: -100 }),
  observation("2026-10-03T20:07:00.000Z", "weekend", { deviationBps: -300 }),
  observation("2026-10-03T21:07:00.000Z", "weekend", { status: "no-route" }),
  observation("2026-10-05T14:07:00.000Z", "regular", { deviationBps: 50 }),
];

describe("renderReport", () => {
  test("shows the median deviation per session and the no-route count", () => {
    expect(renderReport(series)).toBe(
      [
        "4 observations, 2026-10-03T19:07:00.000Z to 2026-10-05T14:07:00.000Z.",
        "Median deviation from Jupiter's reference price (count). Quotes, not executions.",
        "",
        "| Token | Lot | weekend | regular | No route |",
        "| --- | --- | ---: | ---: | ---: |",
        "| NVDAx | demo-lot | −2.00% (2) | +0.50% (1) | 1 of 4 |",
      ].join("\n")
    );
  });

  test("says so when there is nothing to report", () => {
    expect(renderReport([])).toBe("No observations found.");
  });
});

describe("readObservations", () => {
  test("reads every day file in chronological order", () => {
    const dir = mkdtempSync(join(tmpdir(), "quotes-"));
    const line = (o: Observation) => `${JSON.stringify(o)}\n`;
    writeFileSync(join(dir, "2026-10-05.jsonl"), line(series[3]!));
    writeFileSync(
      join(dir, "2026-10-03.jsonl"),
      line(series[0]!) + line(series[1]!)
    );
    writeFileSync(join(dir, "README.md"), "not data");

    expect(readObservations(dir).map((o) => o.observedAt)).toEqual([
      "2026-10-03T19:07:00.000Z",
      "2026-10-03T20:07:00.000Z",
      "2026-10-05T14:07:00.000Z",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/quotes/report.test.ts`
Expected: FAIL, cannot resolve `report.ts`.

- [ ] **Step 3: Implement `report.ts`**

Create `scripts/quotes/report.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { SESSIONS, type Session } from "./session.ts";
import type { Observation } from "./types.ts";
import { formatBps } from "./units.ts";

type Row = {
  symbol: string;
  lot: string;
  deviations: Map<Session, number[]>;
  noRoute: number;
  attempts: number;
};

/** Reads every `YYYY-MM-DD.jsonl` file in `dir`, oldest first. */
export function readObservations(dir: string): Observation[] {
  return readdirSync(dir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
    .sort()
    .flatMap((name) => readFileSync(join(dir, name), "utf8").split("\n"))
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Observation);
}

export function renderReport(observations: readonly Observation[]): string {
  const first = observations[0];
  const last = observations.at(-1);
  if (!first || !last) return "No observations found.";

  const sessions = SESSIONS.filter((s) =>
    observations.some((o) => o.session === s)
  );
  const header = [
    `${observations.length} observations, ${first.observedAt} to ${last.observedAt}.`,
    "Median deviation from Jupiter's reference price (count). Quotes, not executions.",
    "",
    `| Token | Lot | ${sessions.join(" | ")} | No route |`,
    `| --- | --- | ${sessions.map(() => "---:").join(" | ")} | ---: |`,
  ];
  const rows = summarize(observations).map((row) => {
    const cells = sessions.map((session) => {
      const values = row.deviations.get(session) ?? [];
      return values.length
        ? `${formatBps(median(values))} (${values.length})`
        : "–";
    });
    return `| ${row.symbol} | ${row.lot} | ${cells.join(" | ")} | ${row.noRoute} of ${row.attempts} |`;
  });
  return [...header, ...rows].join("\n");
}

/** One row per token and lot, in the order they first appear. */
function summarize(observations: readonly Observation[]): Row[] {
  const rows = new Map<string, Row>();
  for (const observation of observations) {
    for (const token of observation.tokens) {
      for (const quote of token.quotes) {
        const key = `${token.symbol}/${quote.lot}`;
        const row = rows.get(key) ?? {
          symbol: token.symbol,
          lot: quote.lot,
          deviations: new Map(),
          noRoute: 0,
          attempts: 0,
        };
        rows.set(key, row);
        row.attempts += 1;
        if (quote.status === "no-route") row.noRoute += 1;
        if (quote.status === "ok" && quote.deviationBps !== undefined) {
          const values = row.deviations.get(observation.session) ?? [];
          values.push(quote.deviationBps);
          row.deviations.set(observation.session, values);
        }
      }
    }
  }
  return [...rows.values()];
}

/** Median in basis points; an even count takes the lower midpoint average. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return Math.floor(((sorted[middle - 1] ?? 0) + upper) / 2);
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { data: { type: "string" } } });
  if (!values.data)
    throw new Error("Usage: bun scripts/quotes/report.ts --data <data dir>");
  console.log(renderReport(readObservations(values.data)));
}
```

- [ ] **Step 4: Run tests and type-check**

Run: `bun test tests/quotes && npm run typecheck:scripts`
Expected: PASS; no type errors.

Run: `bun scripts/quotes/report.ts --data /tmp/bidwall-quotes`
Expected: a table with one row per token and lot from the live run in Task 5.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write scripts/quotes tests/quotes
git add scripts/quotes/report.ts tests/quotes/report.test.ts
git commit -m "feat: summarise quote observations by market session"
```

---

### Task 7: Evidence branch, hourly workflow and docs

**Files:**

- Create: `.github/workflows/quote-observer.yml`, `docs/QUOTE-OBSERVER.md`
- Modify: `docs/STATUS.md` (quote observer row), `README.md` (one link)
- Create on branch `evidence/quotes` only: `README.md`

- [ ] **Step 1: Create the orphan evidence branch without touching the working tree**

```bash
readme=$(printf '%s\n' \
  "# Bidwall quote observations" "" \
  "Hourly Jupiter sell quotes for five xStocks into USDC, written by" \
  "\`.github/workflows/quote-observer.yml\` on \`main\`. Quotes only; nothing here executed." "" \
  "- \`quotes/YYYY-MM-DD.jsonl\`: one summary line per run (schema \`bidwall.quote-observation/v1\`)." \
  "- \`quotes/raw/*.json.gz\`: every raw HTTP exchange for that run; its SHA-256 is in the summary line." "" \
  "Summarise with \`bun scripts/quotes/report.ts --data quotes\` from a \`main\` checkout." \
  | git hash-object -w --stdin)
tree=$(printf '100644 blob %s\tREADME.md\n' "$readme" | git mktree)
commit=$(git commit-tree "$tree" -m "data: start quote observation branch" \
  -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>")
git update-ref refs/heads/evidence/quotes "$commit"
git push -u origin evidence/quotes
```

Expected: `git ls-tree evidence/quotes` lists only `README.md`; `git status` on `main` is unchanged.

- [ ] **Step 2: Write the workflow**

Create `.github/workflows/quote-observer.yml`:

```yaml
name: Quote observer

on:
  schedule:
    - cron: "7 * * * *"
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: quote-observer
  cancel-in-progress: false

jobs:
  observe:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Check out the observer
        uses: actions/checkout@v4

      - name: Check out the evidence branch
        uses: actions/checkout@v4
        with:
          ref: evidence/quotes
          path: evidence

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2

      # The observer uses only node: built-ins, so no dependency install is needed.
      - name: Observe
        run: bun scripts/quotes/observe.ts --out evidence/quotes --runner github-actions

      # Runs even when every quote failed, so outages are recorded too.
      - name: Commit the observation
        if: always()
        working-directory: evidence
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add quotes
          if git diff --cached --quiet; then exit 0; fi
          git commit -m "data: quote observation $(date -u +%Y-%m-%dT%H:%MZ)"
          git push || (git pull --rebase && git push)
```

- [ ] **Step 3: Write the docs**

Create `docs/QUOTE-OBSERVER.md`:

````markdown
# Quote observer

Hourly evidence of how much tokenized-stock collateral the on-chain market can
absorb, and how that changes when the US market is shut.

**What it records:** Jupiter sell quotes into USDC for NVDAx, TSLAx, AAPLx,
METAx and SPYx at $10k, $50k, $100k, $250k, $500k and $1M, plus the exact NVDAx
lot the Bidwall demo settles (396,422,366 raw atoms). Each run is labelled with
its US market session in New York time.

**What it does not record:** executions. Every record says "Mainnet Jupiter
quote, not executed". The reference price is Jupiter's, not Kamino's oracle.

## Run it

```sh
bun scripts/quotes/observe.ts --out /tmp/bidwall-quotes   # one run, about 40 s
bun scripts/quotes/report.ts --data /tmp/bidwall-quotes    # summary table
npm run test:quotes                                        # offline tests
```
````

## The hourly series

`.github/workflows/quote-observer.yml` runs at minute 7 of every hour and
commits to the `evidence/quotes` branch, never `main`. To read it:

```sh
git fetch origin evidence/quotes
git worktree add ../bidwall-evidence evidence/quotes
bun scripts/quotes/report.ts --data ../bidwall-evidence/quotes
```

Each `quotes/YYYY-MM-DD.jsonl` line is one run; its `raw.path` points to the
gzip file holding every HTTP exchange, and `raw.sha256` lets you check it.

## Limits

- GitHub may start scheduled runs late; `observedAt` is the real start time.
- Jupiter may rate-limit shared GitHub runners. Failed quotes are kept as
  `error` records. If they dominate, run the same command on a local timer.
- Deviation is measured against Jupiter's own price, at one instant, for a
  single sale. Real liquidations can be partial and paced.

Design: [`superpowers/specs/2026-10-03-quote-observer-design.md`](superpowers/specs/2026-10-03-quote-observer-design.md).

````

In `docs/STATUS.md`, replace the quote observer row with:

```markdown
| Quote observer     | Hourly Jupiter quotes for five xStocks and the demo lot, labelled by market session, on the `evidence/quotes` branch | Enough weekend and trading-hours runs to cite; Kamino oracle comparison              |
````

In `README.md`, after the sentence ending "the receipt.", add:

```markdown
The [quote observer](docs/QUOTE-OBSERVER.md) records hourly mainnet exit-depth evidence.
```

- [ ] **Step 4: Verify everything**

Run: `npm run ci`
Expected: build, lint, formatting, script type-check and quote tests all pass.

- [ ] **Step 5: Commit, push and run the workflow once by hand**

```bash
npx prettier --write .github docs README.md
git add .github/workflows/quote-observer.yml docs/QUOTE-OBSERVER.md docs/STATUS.md README.md
git commit -m "ci: observe quotes hourly into the evidence branch"
git push
gh workflow run quote-observer.yml
gh run watch "$(gh run list --workflow quote-observer.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: the run succeeds; `git fetch origin evidence/quotes && git ls-tree -r --name-only origin/evidence/quotes` lists a `quotes/YYYY-MM-DD.jsonl` file and one `quotes/raw/*.json.gz`. If the run shows mostly `error` quotes with HTTP 429, record that and switch to a local timer before relying on the series.

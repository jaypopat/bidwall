import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  buildSnapshot,
  parseQuoteEvidence,
  readLatestQuotes,
  saveScanError,
  saveSnapshot,
} from "../../scripts/risk/snapshot.ts";
import { createRpcClient } from "../../scripts/risk/rpc.ts";
import { classifySession } from "../../scripts/quotes/session.ts";
import { fixture, quoteToken } from "./fixtures.ts";

const dirs: string[] = [];
function temporary() {
  const dir = mkdtempSync(join(tmpdir(), "bidwall-risk-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function mockRpc(loans = fixture.loans) {
  return createRpcClient({
    url: "https://rpc.example.test/?api-key=never-store-me",
    fetch: async (_, init) => {
      const request = JSON.parse(String(init.body));
      const reserveMap = new Map(
        fixture.reserves.map((r) => [r.address, r.account])
      );
      reserveMap.set(fixture.market.address, fixture.market.account);
      return Response.json({
        jsonrpc: "2.0",
        id: request.id,
        result:
          request.method === "getProgramAccounts"
            ? { context: { slot: fixture.slot }, value: loans }
            : {
                context: { slot: fixture.reserveSlot },
                value: request.params[0].map((address: string) =>
                  reserveMap.get(address)
                ),
              },
      });
    },
  });
}
const evidence = () => ({
  schema: "bidwall.quote-observation/v1",
  observedAt: "2026-10-03T18:00:00.000Z",
  tokens: [quoteToken([-100])],
});

test("captures both slots, exclusion counts, exact inputs and a reproducible raw hash", async () => {
  const elevated = structuredClone(fixture.loans[0]!);
  const data = Buffer.from(elevated.account.data[0], "base64");
  data[2285] = 1;
  elevated.pubkey = fixture.market.address;
  elevated.account.data[0] = data.toString("base64");
  const result = await buildSnapshot({
    rpc: mockRpc([...fixture.loans, elevated]),
    quotes: parseQuoteEvidence(evidence()),
    now: new Date("2026-10-03T19:00:00.000Z"),
  });
  expect(result.snapshot.slot).toBe(fixture.slot);
  expect(result.snapshot.reserveSlot).toBe(fixture.reserveSlot);
  expect(result.snapshot.loansRead).toBe(fixture.loans.length + 1);
  expect(result.snapshot.loansModelled).toBe(fixture.loans.length);
  expect(result.snapshot.loansNotModelled).toEqual([
    { reason: "elevation-group", count: 1 },
  ]);
  expect(result.snapshot.quoteAgeSeconds).toBe(3600);
  expect(result.snapshot.rpcHost).toBe("rpc.example.test");
  const dir = temporary();
  const saved = saveSnapshot(dir, result);
  const bytes = readFileSync(join(dir, saved.raw!.path));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    saved.raw!.sha256
  );
  const raw = JSON.parse(gunzipSync(bytes).toString());
  expect(raw.loans[0].deposits[0].ctokens).toMatch(/^\d+$/);
  expect(raw.loans[0].borrows[0].borrowedSf).toMatch(/^\d+$/);
  expect(raw.market.maxRepayUsd).toBe("1000000000000");
  expect(JSON.stringify(saved)).not.toContain("never-store-me");
  expect(
    JSON.parse(readFileSync(join(dir, "2026-10-03.jsonl"), "utf8"))
  ).toEqual(saved);
});
test("records a failed scan as evidence and keeps missing/future quotes unknown", async () => {
  const dir = temporary();
  const now = new Date("2026-10-03T00:00:00Z");
  saveScanError(dir, {
    schema: "bidwall.risk-snapshot/v1",
    status: "error",
    observedAt: now.toISOString(),
    session: classifySession(now),
    rpcHost: "rpc.example.test",
    error: "getProgramAccounts: HTTP 429",
  });
  expect(
    JSON.parse(readFileSync(join(dir, "2026-10-03.jsonl"), "utf8")).status
  ).toBe("error");
  const result = await buildSnapshot({
    rpc: mockRpc(),
    quotes: parseQuoteEvidence(evidence()),
    now,
  });
  expect(result.snapshot.quoteObservedAt).toBeNull();
  expect(result.snapshot.quoteIssue).toContain("newer");
  expect(
    result.snapshot.scenarios[0]!.rows.every(
      (r) => r.absorbableUsd === null && r.shortfallUsd === null
    )
  ).toBe(true);
});
test("reads the latest valid observation with an explicit warning on malformed evidence", () => {
  const dir = temporary();
  expect(readLatestQuotes(dir).quotes).toBeNull();
  writeFileSync(
    join(dir, "2026-10-03.jsonl"),
    `${JSON.stringify(evidence())}\n{\n`
  );
  const result = readLatestQuotes(dir);
  expect(result.quotes?.observedAt).toBe(evidence().observedAt);
  expect(result.issue).toContain("malformed");
  const missing = readLatestQuotes(join(dir, "missing"));
  expect(missing.issue).toContain("unavailable");
});
test("rejects ambiguous or malformed quote evidence", () => {
  const bad = evidence();
  bad.tokens.push(bad.tokens[0]!);
  expect(() => parseQuoteEvidence(bad)).toThrow("Duplicate quote mint");
  const badLot = evidence();
  badLot.tokens[0]!.quotes[0]!.inAmountRaw = "-1";
  expect(() => parseQuoteEvidence(badLot)).toThrow("integer string");
  expect(() =>
    parseQuoteEvidence({ ...evidence(), observedAt: "invalid" })
  ).toThrow("timestamp");
});

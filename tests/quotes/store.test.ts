import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { JUPITER_ENDPOINTS } from "../../scripts/quotes/jupiter.ts";
import { rawFileName, saveObservation } from "../../scripts/quotes/store.ts";
import type { ObservationDraft } from "../../scripts/quotes/types.ts";

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
const lines = (path: string) => readFileSync(path, "utf8").trim().split("\n");

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

    const day = lines(join(dir, "2026-10-03.jsonl"));
    expect(day).toHaveLength(1);
    expect(JSON.parse(day[0] ?? "")).toEqual(saved);
  });

  test("appends to the day's file and starts a new file each UTC day", () => {
    const dir = mkdtempSync(join(tmpdir(), "quotes-"));
    saveObservation(dir, draft("2026-10-03T22:07:00.000Z"), exchanges);
    saveObservation(dir, draft("2026-10-03T23:07:00.000Z"), exchanges);
    saveObservation(dir, draft("2026-10-04T00:07:00.000Z"), exchanges);

    expect(lines(join(dir, "2026-10-03.jsonl"))).toHaveLength(2);
    expect(lines(join(dir, "2026-10-04.jsonl"))).toHaveLength(1);
    expect(readdirSync(join(dir, "raw"))).toHaveLength(3);
  });
});

test("rawFileName drops milliseconds and colons", () => {
  expect(rawFileName("2026-10-03T18:14:26.123Z")).toBe(
    "2026-10-03T18-14-26Z.json.gz"
  );
});

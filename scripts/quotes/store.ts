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

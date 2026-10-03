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

/** Median in basis points; an even count averages the two middle values, rounded down. */
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

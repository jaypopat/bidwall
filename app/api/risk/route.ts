import {
  buildSnapshot,
  readLatestQuotes,
  type RiskSnapshot,
} from "@/scripts/risk/snapshot";
import { createRpcClient } from "@/scripts/risk/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

// Concurrent requests share only the in-flight read. A later scan always reads mainnet again.
let pending: Promise<RiskSnapshot> | null = null;

async function scan() {
  const latest = readLatestQuotes(
    process.env.EVIDENCE_DIR ?? "../bidwall-evidence/quotes"
  );
  const result = await buildSnapshot({
    rpc: createRpcClient({ url: process.env.SOLANA_RPC_URL }),
    quotes: latest.quotes,
    quoteIssue: latest.issue,
  });
  return result.snapshot;
}

export async function GET() {
  try {
    if (!pending)
      pending = scan().finally(() => {
        pending = null;
      });
    return Response.json(await pending, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        error:
          "The mainnet risk scan failed. Check the server RPC configuration and try again.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}

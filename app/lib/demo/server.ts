import "server-only";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DemoReceipt, DemoResponse, DemoStage, DemoStep } from "./types";

const receiptPath = resolve(process.cwd(), "build/demo/receipt.json");
const localNames = new Set(["localhost", "127.0.0.1", "::1"]);

type DemoState = {
  running: boolean;
  startedAt?: number;
  output: string[];
  error?: string;
};

const globalDemo = globalThis as typeof globalThis & {
  bidwallDemo?: DemoState;
};
const state = (globalDemo.bidwallDemo ??= { running: false, output: [] });

export function localDemoEnabled(request: Request): boolean {
  if (
    process.env.BIDWALL_LOCAL_DEMO !== "1" ||
    process.env.NODE_ENV !== "development"
  )
    return false;
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    if (!localNames.has(new URL(`http://${host}`).hostname)) return false;
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== host) return false;
    return true;
  } catch {
    return false;
  }
}

function isAtoms(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function isAddress(value: unknown): value is string {
  return (
    typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
  );
}

function isSignature(value: unknown): value is string {
  return (
    typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(value)
  );
}

function readSettlement(value: unknown): DemoReceipt["settlement"] {
  if (!value || typeof value !== "object") return undefined;
  const s = value as Record<string, unknown>;
  if (
    !isAddress(s.bid) ||
    !isAddress(s.obligation) ||
    ![
      s.paidUsdcAtoms,
      s.repaidUsdcAtoms,
      s.borrowerUsdcAtoms,
      s.deliveredNvdaAtoms,
      s.remainingQuantity,
      s.remainingFunds,
    ].every(isAtoms)
  )
    return undefined;
  return {
    bid: s.bid,
    obligation: s.obligation,
    paidUsdcAtoms: s.paidUsdcAtoms,
    repaidUsdcAtoms: s.repaidUsdcAtoms,
    borrowerUsdcAtoms: s.borrowerUsdcAtoms,
    deliveredNvdaAtoms: s.deliveredNvdaAtoms,
    remainingQuantity: s.remainingQuantity,
    remainingFunds: s.remainingFunds,
  } as DemoReceipt["settlement"];
}

async function readReceipt(): Promise<DemoReceipt | null> {
  try {
    const raw = JSON.parse(await readFile(receiptPath, "utf8"));
    if (
      (raw.status !== "running" &&
        raw.status !== "passed" &&
        raw.status !== "failed") ||
      typeof raw.startedAt !== "string" ||
      !Number.isFinite(Date.parse(raw.startedAt)) ||
      !Number.isInteger(raw.upstreamSlot) ||
      !/^[a-f0-9]{64}$/.test(raw.fixtureSha256) ||
      !Array.isArray(raw.transactions)
    )
      return null;
    const settlement = readSettlement(raw.settlement);
    if (raw.status === "passed" && !settlement) return null;
    if (settlement) {
      if (
        BigInt(settlement.paidUsdcAtoms) !==
          BigInt(settlement.repaidUsdcAtoms) +
            BigInt(settlement.borrowerUsdcAtoms) ||
        BigInt(settlement.paidUsdcAtoms) + BigInt(settlement.remainingFunds) !==
          1_500_000_000n ||
        BigInt(settlement.deliveredNvdaAtoms) +
          BigInt(settlement.remainingQuantity) !==
          1_000_000_000n
      )
        return null;
    }
    const steps: DemoStep[] = raw.transactions
      .filter(
        (entry: Record<string, unknown>) =>
          typeof entry.label === "string" &&
          (entry.status === "confirmed" ||
            entry.status === "rejected-in-simulation")
      )
      .map((entry: Record<string, unknown>) => {
        const simulation = entry.simulation as
          Record<string, unknown> | undefined;
        const explanation = entry.explanation as
          Record<string, unknown> | undefined;
        return {
          label: entry.label as string,
          status: entry.status as DemoStep["status"],
          signature: isSignature(entry.signature) ? entry.signature : undefined,
          slot: Number.isInteger(entry.slot)
            ? (entry.slot as number)
            : undefined,
          unitsConsumed: Number.isInteger(simulation?.unitsConsumed)
            ? (simulation?.unitsConsumed as number)
            : undefined,
          reason:
            typeof explanation?.reason === "string"
              ? explanation.reason
              : undefined,
        };
      });
    const stageModes: Record<DemoStage["id"], DemoStage["mode"]> = {
      funded: "confirmed",
      locked: "rejected-in-simulation",
      healthy: "rejected-in-simulation",
      stressed: "local-override",
      settled: "confirmed",
      withdrawn: "confirmed",
    };
    const stageOrder = Object.keys(stageModes) as DemoStage["id"][];
    const rawStages: unknown[] = Array.isArray(raw.stages) ? raw.stages : [];
    if (rawStages.length > stageOrder.length) return null;
    const stages: DemoStage[] = rawStages.map((value, index) => {
      const stage = value as Record<string, unknown>;
      const id = stageOrder[index];
      if (!stage || stage.id !== id || stage.mode !== stageModes[id])
        throw new Error("Invalid scenario stage order");
      return { id, mode: stageModes[id] };
    });
    if (
      raw.status === "passed" &&
      stages.length > 0 &&
      stages.length !== stageOrder.length
    )
      return null;
    const capacity = raw.capacityFailure;
    return {
      status: raw.status,
      startedAt: raw.startedAt,
      upstreamSlot: raw.upstreamSlot,
      fixtureSha256: raw.fixtureSha256,
      bidwallSha256:
        typeof raw.bidwallSha256 === "string" ? raw.bidwallSha256 : undefined,
      steps,
      stages,
      settlement,
      capacityFailure:
        isAtoms(capacity?.requestedRepay) && isAtoms(capacity?.availableFunds)
          ? {
              requestedRepay: capacity.requestedRepay,
              availableFunds: capacity.availableFunds,
              status: String(capacity.status),
            }
          : undefined,
      error: typeof raw.error === "string" ? raw.error : undefined,
    };
  } catch {
    return null;
  }
}

export async function getDemoResponse(): Promise<DemoResponse> {
  const receipt = await readReceipt();
  return {
    enabled: true,
    running: state.running,
    output: [...state.output],
    receipt:
      state.startedAt &&
      receipt &&
      Date.parse(receipt.startedAt) < state.startedAt
        ? null
        : receipt,
    error: state.error,
  };
}

export function startDemo(): boolean {
  if (state.running) return false;
  state.running = true;
  state.startedAt = Date.now();
  state.output = [];
  state.error = undefined;
  const child = spawn("npm", ["run", "demo:kamino"], {
    cwd: process.cwd(),
    env: { ...process.env, NO_DNA: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const append = (chunk: Buffer) => {
    state.output = [
      ...state.output,
      ...chunk.toString().split(/\r?\n/).filter(Boolean),
    ].slice(-24);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("error", (error) => {
    state.error = error.message;
    state.running = false;
  });
  child.on("close", (code) => {
    if (code !== 0)
      state.error = `Local demo exited with code ${code}. Check build/demo/surfpool.log.`;
    state.running = false;
  });
  return true;
}

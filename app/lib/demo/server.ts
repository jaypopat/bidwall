import "server-only";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  DemoPair,
  DemoReceipt,
  DemoResponse,
  DemoStage,
  DemoStep,
} from "./types";
import { DEMO_TERMS, demoBudget, type DemoTerms } from "../bidwall/demo-terms";

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
      s.deliveredCollateralAtoms,
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
    deliveredCollateralAtoms: s.deliveredCollateralAtoms,
    remainingQuantity: s.remainingQuantity,
    remainingFunds: s.remainingFunds,
  } as DemoReceipt["settlement"];
}

/** Receipts name their pair; the pair fixes the terms every amount must match. */
function readPair(value: unknown): { pair: DemoPair; terms: DemoTerms } | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  const terms = DEMO_TERMS[p.id as DemoPair["id"]];
  if (
    !terms ||
    p.symbol !== terms.pair.symbol ||
    p.decimals !== terms.pair.decimals
  )
    return null;
  return {
    pair: { id: terms.pair.id, symbol: p.symbol, decimals: p.decimals },
    terms,
  };
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
    const scenario = readPair(raw.pair);
    if (!scenario) return null;
    const { pair, terms: demo } = scenario;
    const budget = demoBudget(demo);
    const settlement = readSettlement(raw.settlement);
    if (raw.status === "passed" && !settlement) return null;
    if (settlement) {
      if (
        BigInt(settlement.paidUsdcAtoms) !==
          BigInt(settlement.repaidUsdcAtoms) +
            BigInt(settlement.borrowerUsdcAtoms) ||
        BigInt(settlement.paidUsdcAtoms) + BigInt(settlement.remainingFunds) !==
          budget ||
        BigInt(settlement.deliveredCollateralAtoms) +
          BigInt(settlement.remainingQuantity) !==
          demo.quantity
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
    const terms = raw.commitment;
    const commitment =
      terms &&
      [
        terms.start,
        terms.expiry,
        terms.scenarioNow,
        terms.price,
        terms.quantity,
        terms.fundedUsdcAtoms,
      ].every(isAtoms)
        ? {
            start: terms.start,
            expiry: terms.expiry,
            scenarioNow: terms.scenarioNow,
            price: terms.price,
            quantity: terms.quantity,
            fundedUsdcAtoms: terms.fundedUsdcAtoms,
          }
        : undefined;
    if (
      terms &&
      (!commitment ||
        BigInt(commitment.start) > BigInt(commitment.scenarioNow) ||
        BigInt(commitment.scenarioNow) >= BigInt(commitment.expiry) ||
        commitment.price !== demo.price.toString() ||
        commitment.quantity !== demo.quantity.toString() ||
        commitment.fundedUsdcAtoms !== budget.toString())
    )
      return null;
    const d = raw.depletion;
    const depletion =
      d &&
      isAddress(d.bid) &&
      [
        d.fundedUsdcAtoms,
        d.deliveredCollateralAtoms,
        d.remainingFunds,
        d.remainingQuantity,
        d.uncoveredRepayUsdcAtoms,
      ].every(isAtoms) &&
      d.status === "exhausted-and-rejected-in-simulation" &&
      d.remainingFunds === "0" &&
      d.remainingQuantity === "0" &&
      d.bid !== settlement?.bid &&
      d.fundedUsdcAtoms === settlement?.paidUsdcAtoms &&
      d.deliveredCollateralAtoms === settlement?.deliveredCollateralAtoms &&
      d.uncoveredRepayUsdcAtoms === settlement?.repaidUsdcAtoms
        ? ({
            bid: d.bid,
            fundedUsdcAtoms: d.fundedUsdcAtoms,
            deliveredCollateralAtoms: d.deliveredCollateralAtoms,
            remainingFunds: d.remainingFunds,
            remainingQuantity: d.remainingQuantity,
            uncoveredRepayUsdcAtoms: d.uncoveredRepayUsdcAtoms,
            status: d.status,
          } as DemoReceipt["depletion"])
        : undefined;
    if (d && !depletion) return null;
    const capacity = raw.capacityFailure;
    return {
      status: raw.status,
      pair,
      startedAt: raw.startedAt,
      upstreamSlot: raw.upstreamSlot,
      fixtureSha256: raw.fixtureSha256,
      bidwallSha256:
        typeof raw.bidwallSha256 === "string" ? raw.bidwallSha256 : undefined,
      steps,
      stages,
      commitment,
      depletion,
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

export function startDemo(pair: DemoPair["id"]): boolean {
  if (state.running) return false;
  state.running = true;
  state.startedAt = Date.now();
  state.output = [];
  state.error = undefined;
  const child = spawn("npm", ["run", "demo:kamino"], {
    cwd: process.cwd(),
    env: { ...process.env, NO_DNA: "1", DEMO_PAIR: pair },
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

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync } from "node:fs";
import { createServer } from "node:net";
import * as kit from "@solana/kit";
import { createRequire } from "node:module";
const { explainSimulationFailure } = createRequire(import.meta.url)(
  "../../build/client/app/lib/bidwall/client.js"
);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function startRuntime() {
  const port = Number(process.env.BIDWALL_DEMO_PORT ?? 18999);
  assert(
    Number.isInteger(port) && port > 1024 && port < 65534,
    "Invalid demo port"
  );
  // Refuse to modify a previously running local chain. Every demo gets a fresh process.
  for (const number of [port, port + 1])
    await new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(number, "127.0.0.1", () => server.close(resolve));
    });
  const url = `http://127.0.0.1:${port}`;
  mkdirSync("build/demo", { recursive: true });
  const log = openSync("build/demo/surfpool.log", "w");
  const child = spawn(
    "surfpool",
    [
      "start",
      "--offline",
      "--port",
      String(port),
      "--ws-port",
      String(port + 1),
      "--host",
      "127.0.0.1",
      "--no-deploy",
      "--no-tui",
      "--airdrop-amount",
      "0",
    ],
    { env: { ...process.env, NO_DNA: "1" }, stdio: ["ignore", log, log] }
  );
  closeSync(log);
  let startError;
  child.on("error", (error) => {
    startError = error;
  });
  const rpc = async (method, params = []) => {
    const result = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!result.ok)
      throw new Error(
        `${method}: HTTP ${result.status}: ${await result.text()}`
      );
    const body = await result.json();
    if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
    return body.result;
  };
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        pause(3000),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  };
  const shutdown = () => child.kill("SIGTERM");
  process.once("exit", shutdown);
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (startError) throw startError;
      if (child.exitCode !== null)
        throw new Error("Surfpool exited; inspect build/demo/surfpool.log");
      try {
        await rpc("getHealth");
        ready = true;
        break;
      } catch {
        await pause(200);
      }
    }
    assert(ready, "Surfpool did not become ready");
  } catch (error) {
    await stop();
    throw error;
  }
  const account = async (key) => {
    const { value } = await rpc("getAccountInfo", [
      key,
      { encoding: "base64" },
    ]);
    if (!value) throw new Error(`Missing account ${key}`);
    return { ...value, data: Buffer.from(value.data[0], "base64") };
  };
  return { rpc, account, url, stop };
}
export function transactionRunner(runtime, payer, receipts) {
  let lookupTables = {};
  const setLookupTables = (tables) => {
    lookupTables = tables;
  };
  async function transact(
    label,
    instructions,
    { expectedError, readAccounts = [] } = {}
  ) {
    const { rpc } = runtime;
    const clockAddress = "SysvarC1ock11111111111111111111111111111111";
    const scenarioClock = (await runtime.account(clockAddress)).data;
    const { value: lifetime } = await rpc("getLatestBlockhash");
    const message = kit.pipe(
      kit.createTransactionMessage({ version: 0 }),
      (m) => kit.setTransactionMessageFeePayerSigner(payer, m),
      (m) =>
        kit.setTransactionMessageLifetimeUsingBlockhash(
          {
            ...lifetime,
            lastValidBlockHeight: BigInt(lifetime.lastValidBlockHeight),
          },
          m
        ),
      (m) =>
        kit.appendTransactionMessageInstructions(
          [
            {
              programAddress: kit.address(
                "ComputeBudget111111111111111111111111111111"
              ),
              accounts: [],
              data: new Uint8Array([2, 128, 26, 6, 0]),
            },
            ...instructions,
          ],
          m
        ),
      (m) =>
        kit.compressTransactionMessageUsingAddressLookupTables(m, lookupTables)
    );
    const tx = await kit.signTransactionMessageWithSigners(message),
      wire = kit.getBase64EncodedWireTransaction(tx);
    assert(
      Buffer.from(wire, "base64").length <= 1232,
      `${label}: v0 packet exceeds 1232 bytes`
    );
    const { value: simulation } = await rpc("simulateTransaction", [
      wire,
      {
        encoding: "base64",
        sigVerify: true,
        ...(readAccounts.length
          ? { accounts: { encoding: "base64", addresses: readAccounts } }
          : {}),
      },
    ]);
    const receipt = {
      label,
      simulation: {
        error: simulation.err,
        logs: simulation.logs,
        unitsConsumed: simulation.unitsConsumed,
      },
      status: "simulated",
    };
    if (simulation.err)
      receipt.explanation = explainSimulationFailure(simulation.logs ?? []);
    receipts.push(receipt);
    if (expectedError) {
      assert.deepEqual(
        simulation.err,
        expectedError,
        JSON.stringify(simulation.logs)
      );
      receipt.status = "rejected-in-simulation";
      console.log(`REJECTED: ${label}`);
      return { simulation, receipt };
    }
    assert.equal(simulation.err, null, JSON.stringify(simulation.logs));
    const signature = await rpc("sendTransaction", [
      wire,
      { encoding: "base64", skipPreflight: false },
    ]);
    await rpc("surfnet_resumeClock");
    let status;
    for (let i = 0; i < 100; i++) {
      status = (await rpc("getSignatureStatuses", [[signature]])).value[0];
      if (
        status?.confirmationStatus === "confirmed" ||
        status?.confirmationStatus === "finalized"
      )
        break;
      await pause(100);
    }
    await rpc("surfnet_pauseClock");
    // Surfpool 1.3's internal wall clock advances independently after slot travel.
    // Preserve the scenario timestamp between steps while retaining the new absolute slot.
    const clock = (await runtime.account(clockAddress)).data;
    clock.writeBigInt64LE(scenarioClock.readBigInt64LE(32), 32);
    await rpc("surfnet_setAccount", [
      clockAddress,
      { data: clock.toString("hex") },
    ]);
    assert(
      status && ["confirmed", "finalized"].includes(status.confirmationStatus),
      "Local transaction was not confirmed"
    );
    assert.equal(status.err, null);
    receipt.status = "confirmed";
    receipt.signature = signature;
    receipt.slot = status.slot;
    console.log(`CONFIRMED: ${label}`);
    return { simulation, receipt };
  }
  return { transact, setLookupTables };
}

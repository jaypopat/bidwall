import { expect, test } from "bun:test";
import { createRpcClient } from "../../scripts/risk/rpc.ts";
import { MARKET, PROGRAM } from "../../scripts/risk/kamino.ts";
import { fixture } from "./fixtures.ts";

function success(id: number, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result });
}
test("requests indebted mainnet obligations with context and a confirmed reserve read no older than them", async () => {
  const requests: { method: string; params: unknown[] }[] = [];
  const rpc = createRpcClient({
    fetch: async (_, init) => {
      const request = JSON.parse(String(init.body));
      requests.push(request);
      return success(
        request.id,
        request.method === "getProgramAccounts"
          ? { context: { slot: fixture.slot }, value: fixture.loans }
          : {
              context: { slot: fixture.reserveSlot },
              value: [fixture.market.account],
            }
      );
    },
  });
  const loans = await rpc.getLoans();
  const config = await rpc.getAccounts([MARKET], loans.slot);
  expect(requests[0]!.params).toEqual([
    PROGRAM,
    {
      encoding: "base64",
      commitment: "confirmed",
      withContext: true,
      filters: [
        { dataSize: 3344 },
        { memcmp: { offset: 32, bytes: MARKET } },
        { memcmp: { offset: 2287, bytes: "2" } },
      ],
    },
  ]);
  expect(requests[1]!.params[1]).toEqual({
    encoding: "base64",
    commitment: "confirmed",
    minContextSlot: fixture.slot,
  });
  expect(config.accounts[0]!.data.length).toBe(4664);
});
test("retries once and never includes an RPC key or error body", async () => {
  let calls = 0;
  const rpc = createRpcClient({
    url: "https://rpc.example.test/?api-key=secret-xyz",
    sleep: async () => {},
    fetch: async () => {
      calls++;
      throw new Error(
        "Failure at https://rpc.example.test/?api-key=secret-xyz"
      );
    },
  });
  expect(rpc.host).toBe("rpc.example.test");
  await expect(rpc.getLoans()).rejects.toThrow(
    "getProgramAccounts: request failed or timed out"
  );
  expect(calls).toBe(2);
  const response = createRpcClient({
    sleep: async () => {},
    fetch: async (_, init) =>
      Response.json({
        jsonrpc: "2.0",
        id: JSON.parse(String(init.body)).id,
        error: { code: -32005, message: "secret-xyz" },
      }),
  });
  await expect(response.getLoans()).rejects.toThrow("RPC code -32005");
});
test("attaches a timeout to each retry", async () => {
  let calls = 0;
  const rpc = createRpcClient({
    timeoutMs: 5,
    sleep: async () => {},
    fetch: async (_, init) => {
      calls++;
      return new Promise<Response>((_, reject) =>
        init.signal!.addEventListener(
          "abort",
          () => reject(new Error("timeout")),
          { once: true }
        )
      );
    },
  });
  await expect(rpc.getLoans()).rejects.toThrow("timed out");
  expect(calls).toBe(2);
});
test("rejects wrong envelopes, duplicate loans, missing accounts, stale slots and invalid encoding", async () => {
  for (const result of [
    { context: { slot: 99 }, value: [fixture.market.account] },
    { context: { slot: 101 }, value: [] },
    { context: { slot: 101 }, value: [null] },
    {
      context: { slot: 101 },
      value: [{ ...fixture.market.account, data: ["garbage", "base64"] }],
    },
  ]) {
    const rpc = createRpcClient({
      fetch: async (_, init) =>
        success(JSON.parse(String(init.body)).id, result),
    });
    await expect(rpc.getAccounts([MARKET], 100)).rejects.toThrow();
  }
  const duplicate = createRpcClient({
    fetch: async (_, init) =>
      success(JSON.parse(String(init.body)).id, {
        context: { slot: 100 },
        value: [fixture.loans[0], fixture.loans[0]],
      }),
  });
  await expect(duplicate.getLoans()).rejects.toThrow("Duplicate");
  const wrongEnvelope = createRpcClient({
    sleep: async () => {},
    fetch: async () => success(999, {}),
  });
  await expect(wrongEnvelope.getLoans()).rejects.toThrow("envelope");
});

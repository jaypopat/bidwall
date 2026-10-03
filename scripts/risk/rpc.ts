import { addressBytes, MARKET, PROGRAM, type Account } from "./kamino.ts";
import {
  readArray,
  readNumber,
  readRecord,
  readString,
} from "../quotes/validate.ts";

export const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type RpcClient = ReturnType<typeof createRpcClient>;

function slotOf(value: unknown): number {
  const slot = readNumber(readRecord(value, "context"), "slot");
  if (!Number.isSafeInteger(slot) || slot < 0)
    throw new Error("Invalid RPC slot");
  return slot;
}

function accountOf(address: string, value: unknown): Account {
  addressBytes(address);
  const record = readRecord(value, "account");
  const data = readArray(record, "data");
  if (
    data.length !== 2 ||
    data[1] !== "base64" ||
    typeof data[0] !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      data[0]
    )
  )
    throw new Error("Invalid RPC account encoding");
  return {
    address,
    owner: readString(record, "owner"),
    data: Buffer.from(data[0], "base64"),
  };
}

/** Errors intentionally omit response bodies, request URLs, and credentials. */
export function createRpcClient(
  options: {
    url?: string;
    fetch?: FetchLike;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {}
) {
  const url = new URL(options.url || PUBLIC_RPC);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Invalid RPC protocol");
  const fetcher = options.fetch ?? fetch;
  const sleep =
    options.sleep ??
    ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let id = 0;
  async function request(method: string, params: unknown[]): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const requestId = ++id;
      try {
        const response = await fetcher(url.toString(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: requestId,
            method,
            params,
          }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = readRecord(await response.json(), "RPC response");
        if (body.id !== requestId || body.jsonrpc !== "2.0")
          throw new Error("Invalid RPC envelope");
        if (body.error !== undefined) {
          const code = readNumber(readRecord(body.error, "RPC error"), "code");
          throw new Error(`RPC code ${code}`);
        }
        if (body.result === undefined) throw new Error("Missing RPC result");
        return body.result;
      } catch (error) {
        if (attempt === 1) {
          const message =
            error instanceof Error &&
            /^(HTTP \d{3}|RPC code -?\d+|Invalid RPC envelope|Missing RPC result)$/.test(
              error.message
            )
              ? error.message
              : "request failed or timed out";
          throw new Error(`${method}: ${message}`);
        }
        await sleep(250);
      }
    }
    throw new Error("Unreachable RPC retry state");
  }
  return {
    host: url.hostname,
    async getLoans() {
      const result = readRecord(
        await request("getProgramAccounts", [
          PROGRAM,
          {
            encoding: "base64",
            commitment: "confirmed",
            withContext: true,
            filters: [
              { dataSize: 3344 },
              { memcmp: { offset: 32, bytes: MARKET } },
              { memcmp: { offset: 2287, bytes: "2" } },
            ], // base58 encoding of [1]
          },
        ]),
        "loan result"
      );
      const accounts = readArray(result, "value").map((value) => {
        const row = readRecord(value, "program account");
        return accountOf(readString(row, "pubkey"), row.account);
      });
      if (new Set(accounts.map((a) => a.address)).size !== accounts.length)
        throw new Error("Duplicate obligation in RPC response");
      return { slot: slotOf(result.context), accounts };
    },
    async getAccounts(addresses: string[], minContextSlot: number) {
      if (addresses.length < 1 || addresses.length > 100)
        throw new Error("Expected 1–100 market/reserve accounts");
      addresses.forEach(addressBytes);
      const result = readRecord(
        await request("getMultipleAccounts", [
          addresses,
          {
            encoding: "base64",
            commitment: "confirmed",
            minContextSlot,
          },
        ]),
        "reserve result"
      );
      const values = readArray(result, "value");
      const slot = slotOf(result.context);
      if (values.length !== addresses.length || slot < minContextSlot)
        throw new Error("RPC returned an incomplete or older account set");
      const accounts = addresses.map((address, i) => {
        if (values[i] === null)
          throw new Error("Referenced market/reserve account is missing");
        return accountOf(address, values[i]);
      });
      return { slot, accounts };
    },
  };
}

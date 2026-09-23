export const RPC = process.env.LOCAL_RPC ?? "http://127.0.0.1:18899";
const url = new URL(RPC);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  throw new Error("Fork experiments require a loopback RPC");
export async function rpc(method, params = []) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
export async function account(key) {
  const r = await rpc("getAccountInfo", [key, { encoding: "base64" }]);
  if (!r.value) throw new Error(`Missing ${key}`);
  return {
    ...r.value,
    data: Buffer.from(r.value.data[0], "base64"),
    slot: r.context.slot,
  };
}

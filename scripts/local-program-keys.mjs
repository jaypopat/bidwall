// Public, deterministic LOCAL-ONLY identities. Never fund or deploy these keys on a public cluster.
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
  let n = BigInt(`0x${bytes.toString("hex")}`),
    result = "";
  while (n) {
    result = alphabet[Number(n % 58n)] + result;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = "1" + result;
  }
  return result;
}
mkdirSync("anchor/target/deploy", { recursive: true });
for (const name of ["bidwall", "vault"]) {
  const seed = createHash("sha256")
    .update(`bidwall/local-only/v1/${name}`)
    .digest();
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      seed,
    ]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .subarray(-32);
  const address = base58(publicKey);
  if (!process.argv.includes("--print")) {
    const source = readFileSync(`anchor/programs/${name}/src/lib.rs`, "utf8");
    if (!source.includes(`declare_id!("${address}")`))
      throw new Error(`${name}: local ID mismatch`);
    if (
      !readFileSync("anchor/Anchor.toml", "utf8").includes(
        `${name} = "${address}"`
      )
    )
      throw new Error(`${name}: Anchor ID mismatch`);
    writeFileSync(
      `anchor/target/deploy/${name}-keypair.json`,
      JSON.stringify([...seed, ...publicKey])
    );
  }
  console.log(`${name}: ${address}`);
}

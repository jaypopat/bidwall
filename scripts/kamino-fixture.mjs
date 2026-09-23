import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** Generate a reviewable manifest from the exact bytes that will be committed. */
export function fixtureManifest(bytes) {
  const fixture = JSON.parse(gunzipSync(bytes));
  const evidence = fixture.provenance;
  const transaction = evidence.transactions.at(-1);
  assert.equal(
    transaction.simulation.err,
    null,
    "Fixture must capture successful settlement"
  );
  const discriminator = createHash("sha256")
    .update("event:Settlement")
    .digest()
    .subarray(0, 8);
  const event = transaction.simulation.logs
    .filter((line) => line.startsWith("Program data: "))
    .map((line) => Buffer.from(line.slice(14), "base64"))
    .find(
      (data) => data.length === 152 && data.subarray(0, 8).equals(discriminator)
    );
  assert(event, "Missing Bidwall settlement event");
  const programElfSha256 = {};
  for (const [key, program] of Object.entries(fixture.programs)) {
    const digest = hash(Buffer.from(program.elf, "base64"));
    assert.equal(digest, program.sha256, `Binary hash mismatch: ${key}`);
    programElfSha256[key] = digest;
  }
  const amount = (offset) => {
    const value = event.readBigUInt64LE(offset);
    assert(
      value <= BigInt(Number.MAX_SAFE_INTEGER),
      "Manifest amount exceeds safe JSON integer; use string schema"
    );
    return Number(value);
  };
  return {
    label: evidence.label,
    observedAt: evidence.observedAt,
    coherentSnapshotSlot: evidence.coherentSnapshotSlot,
    localSignature: transaction.signature,
    fixtureSha256: hash(bytes),
    programElfSha256,
    unitsConsumed: transaction.simulation.unitsConsumed,
    rawDeltas: {
      collateralAtoms: amount(104),
      bidUsdcAtoms: amount(112),
      debtUsdcAtoms: amount(120),
      borrowerUsdcAtoms: amount(128),
    },
  };
}

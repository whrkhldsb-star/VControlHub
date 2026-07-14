import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { fingerprintKnownHostsLine, normalizeHostKeyFingerprint, selectPinnedKnownHostsLine } from "../known-hosts";

function keyLine(host: string) {
  const { publicKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  // Ed25519 SPKI ends with the 32-byte raw public key expected by known_hosts.
  const raw = der.subarray(der.length - 32);
  return `${host} ssh-ed25519 ${raw.toString("base64")}`;
}

describe("known_hosts pin selection", () => {
  it("computes OpenSSH SHA256 fingerprints and selects the exact matching line", () => {
    const wrong = keyLine("example.com");
    const correct = keyLine("example.com");
    const expected = fingerprintKnownHostsLine(correct)!;
    expect(expected).toBe(`SHA256:${createHash("sha256").update(Buffer.from(correct.split(" ")[2]!, "base64")).digest("base64").replace(/=+$/, "")}`);
    expect(selectPinnedKnownHostsLine(`${wrong}\n${correct}\n`, expected)).toBe(correct);
  });
  it("normalizes prefixes and fails closed when no scanned key matches", () => {
    const line = keyLine("example.com");
    expect(normalizeHostKeyFingerprint("sha256:abc")).toBe("SHA256:abc");
    expect(() => selectPinnedKnownHostsLine(line, "SHA256:not-the-key")).toThrow(/does not match/);
  });
});

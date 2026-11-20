import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { fingerprintKnownHostsLine, normalizeHostKeyFingerprint, selectPinnedKnownHostsLine } from "../known-hosts";

function keyLine(host: string) {
  const { publicKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  // Ed25519 SPKI ends with the 32-byte raw public key expected by known_hosts.
  const raw = der.subarray(der.length - 32);
  const blob = Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from("ssh-ed25519"), Buffer.from([0, 0, 0, 32]), raw]);
  return `${host} ssh-ed25519 ${blob.toString("base64")}`;
}

describe("known_hosts pin selection", () => {
  it("computes OpenSSH SHA256 fingerprints and selects the exact matching line", () => {
    const wrong = keyLine("example.com");
    const correct = keyLine("example.com");
    const expected = fingerprintKnownHostsLine(correct)!;
    expect(expected).toBe(`SHA256:${createHash("sha256").update(Buffer.from(correct.split(" ")[2]!, "base64")).digest("base64").replace(/=+$/, "")}`);
    expect(selectPinnedKnownHostsLine(`${wrong}\n${correct}\n`, expected)).toBe(correct);
  });
  it("accepts an ECDSA keyscan record and refuses mismatched labels or corrupt encoding", () => {
    const algorithm = "ecdsa-sha2-nistp256";
    const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const { x, y } = publicKey.export({ format: "jwk" });
    const fields = [Buffer.from(algorithm), Buffer.from("nistp256"), Buffer.concat([Buffer.from([4]), Buffer.from(x!, "base64url"), Buffer.from(y!, "base64url")])];
    const blob = Buffer.concat(fields.flatMap(field => [Buffer.from([0, 0, 0, field.length]), field]));
    const line = `host ${algorithm} ${blob.toString("base64")}`;
    const expected = "SHA256:" + createHash("sha256").update(blob).digest("base64").replace(/=+$/, "");
    expect(selectPinnedKnownHostsLine(line, expected)).toBe(line);
    expect(fingerprintKnownHostsLine(line + "!")).toBeNull();
    expect(fingerprintKnownHostsLine(line.replace(algorithm, "ssh-rsa"))).toBeNull();
  });
  it("normalizes prefixes and fails closed when no scanned key matches", () => {
    const line = keyLine("example.com");
    expect(normalizeHostKeyFingerprint("sha256:abc")).toBe("SHA256:abc");
    // SshHostKeyChangedError copy is server-translated (zh/en) — match the
    // mismatch semantics, not one locale's wording.
    expect(() => selectPinnedKnownHostsLine(line, "SHA256:not-the-key")).toThrow(
      /不一致|fingerprint does not match/,
    );
  });
});

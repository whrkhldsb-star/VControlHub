import { utils } from "ssh2";
import { createHash } from "node:crypto";

/** A real, independently generated identity for a configuration round trip. */
export function sshFixture() {
  // ssh2's ed25519 keygen occasionally (~1%) drops a leading zero byte in the OpenSSH public blob.
  for (let attempt = 0; attempt < 16; attempt++) {
    const pair = utils.generateKeyPairSync("ed25519");
    const publicKey = utils.parseKey(pair.public);
    if (publicKey instanceof Error || Array.isArray(publicKey)) continue;
    return { publicKey: pair.public, privateKey: pair.private,
      fingerprint: "SHA256:" + createHash("sha256").update(publicKey.getPublicSSH()).digest("base64").replace(/=+$/, "") };
  }
  throw new Error("Invalid test key");
}

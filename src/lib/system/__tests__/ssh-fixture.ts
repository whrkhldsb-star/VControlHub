import { utils } from "ssh2";
import { createHash } from "node:crypto";

/** A real, independently generated identity for a configuration round trip. */
export function sshFixture() {
  const pair = utils.generateKeyPairSync("ed25519");
  const publicKey = utils.parseKey(pair.public);
  if (publicKey instanceof Error || Array.isArray(publicKey)) throw new Error("Invalid test key");
  return { publicKey: pair.public, privateKey: pair.private,
    fingerprint: "SHA256:" + createHash("sha256").update(publicKey.getPublicSSH()).digest("base64").replace(/=+$/, "") };
}

import { createHash } from "node:crypto";
import { utils } from "ssh2";
import { ValidationError } from "@/lib/errors";
import { isEncrypted } from "@/lib/crypto/service";
import { normalizeImportedSshKey } from "@/lib/server/ssh-keys";
import { decryptSshKeyPassphrase, decryptSshPrivateKey, encryptSshPrivateKey } from "@/lib/ssh/ssh-key-crypto";
import type { ExportFile } from "./config-schema";

type Key = ExportFile["tables"]["sshKeys"][number];

/** Validate the identity even when the file carries only its public half. */
export async function importKeyMaterial(row: Key, store: boolean) {
  if (!row.publicKey.trim()) throw new ValidationError("IMPORT_SSH_IDENTITY");
  if (!row.privateKey) {
    const key = utils.parseKey(row.publicKey);
    if (key instanceof Error || Array.isArray(key) || key.isPrivateKey() || row.passphrase ||
        row.fingerprint !== "SHA256:" + createHash("sha256").update(key.getPublicSSH()).digest("base64").replace(/=+$/, "")) {
      throw new ValidationError("IMPORT_SSH_IDENTITY");
    }
    return { publicKey: row.publicKey, privateKey: null, passphrase: null };
  }
  const privateKey = decryptSshPrivateKey(row.privateKey);
  const key = await normalizeImportedSshKey({ privateKey, publicKey: row.publicKey, passphrase: decryptSshKeyPassphrase(row.passphrase) });
  if (key.fingerprint !== row.fingerprint) throw new ValidationError("IMPORT_SSH_IDENTITY");
  const keepEnvelope = isEncrypted(row.privateKey) && privateKey === key.privateKey;
  return { publicKey: key.publicKey, privateKey: store && !keepEnvelope ? encryptSshPrivateKey(key.privateKey) : row.privateKey, passphrase: null };
}

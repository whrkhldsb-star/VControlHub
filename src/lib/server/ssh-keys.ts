import { createHash, createPrivateKey, type KeyObject } from "node:crypto";
import { parseFromString } from "ppk-to-openssh";
import { parsePrivateKey } from "sshpk";
import { utils } from "ssh2";
import type { RoleKey } from "@/lib/auth/rbac";
import { teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { encryptSshPrivateKey } from "@/lib/ssh/ssh-key-crypto";
import { t } from "@/lib/i18n/service-translations";

type TeamSession = { userId: string; roles: RoleKey[]; currentTeamId: string | null };
type ImportedKey = {
  publicKey?: string;
  privateKey?: string | null;
  keyFile?: Buffer | null;
  passphrase?: string | null;
};

export async function listSshKeys(session?: TeamSession | null) {
  return prisma.sshKey.findMany({
    where: session ? teamWhere(session) : {},
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, fingerprint: true, description: true, teamId: true },
    take: 500, // P2: ssh key 总数有限
  });
}

/** Resolve a key for binding to a server — must be in team scope (or legacy null). */
export async function getSshKeyForSession(id: string, session?: TeamSession | null) {
  if (!session) {
    return prisma.sshKey.findUnique({
      where: { id },
      select: { id: true, name: true, fingerprint: true, description: true, teamId: true },
    });
  }
  return prisma.sshKey.findFirst({
    where: { id, ...teamWhere(session) },
    select: { id: true, name: true, fingerprint: true, description: true, teamId: true },
  });
}

/** Headerless DER has no filename-defined type. Try the three standard
 * private-key containers supported by OpenSSL; never decode binary as UTF-8.
 */
function readDerKey(key: Buffer, passphrase?: string): KeyObject {
  for (const type of ["pkcs8", "pkcs1", "sec1"] as const) {
    try { return createPrivateKey({ key, format: "der", type, passphrase }); }
    catch { /* Continue format detection. */ }
  }
  throw new ValidationError(t("backend.server.sshPrivateKeyImportFailed"));
}

export async function normalizeImportedSshKey(input: ImportedKey) {
  const source = input.keyFile?.length ? input.keyFile : input.privateKey?.trim();
  if (!source) throw new ValidationError(t("backend.server.sshPrivateKeyRequired"));
  const passphrase = input.passphrase || undefined; // Spaces are part of a password.
  let content = typeof source === "string" ? source : source.toString("utf8").trim();
  try {
    if (content.startsWith("PuTTY-User-Key-File-")) {
      content = (await parseFromString(content, passphrase ?? "")).privateKey;
    } else if (Buffer.isBuffer(source) && source[0] === 0x30) {
      content = readDerKey(source, passphrase).export({ format: "pem", type: "pkcs8" }).toString();
    } else if (content.startsWith("-----BEGIN ") && !content.startsWith("-----BEGIN OPENSSH ")) {
      // Node/OpenSSL handles encrypted PKCS#8 as well as legacy PEM ciphers.
      content = createPrivateKey({ key: content, passphrase }).export({ format: "pem", type: "pkcs8" }).toString();
    }
    const key = parsePrivateKey(content, "auto", { passphrase });
    const privateKey = key.toString("openssh");
    // Validate using the actual SSH transport parser before saving.
    const result = utils.parseKey(privateKey);
    if (result instanceof Error) throw result;
    const parsed = Array.isArray(result) ? result[0]! : result;
    const publicBytes = parsed.getPublicSSH();
    const publicKey = `${parsed.type} ${publicBytes.toString("base64")}`;
    if (input.publicKey?.trim()) {
      const supplied = utils.parseKey(input.publicKey.trim());
      if (supplied instanceof Error || Array.isArray(supplied) || !supplied.getPublicSSH().equals(publicBytes)) {
        throw new ValidationError(t("backend.server.sshPublicKeyMismatch"));
      }
    }
    return {
      publicKey,
      privateKey,
      fingerprint: `SHA256:${createHash("sha256").update(publicBytes).digest("base64").replace(/=+$/g, "")}`,
    };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(t("backend.server.sshPrivateKeyImportFailed"));
  }
}

export async function createSshKey(input: ImportedKey & {
  name: string;
  description?: string | null;
  createdById?: string | null;
  session?: TeamSession | null;
}) {
  const name = input.name.trim();
  if (!name) throw new ValidationError(t("backend.server.sshKeyNameRequired"));
  const key = await normalizeImportedSshKey(input);
  const teamId = input.session ? teamCreateData(input.session).teamId : null;
  return prisma.sshKey.create({
    data: {
      name,
      fingerprint: key.fingerprint,
      publicKey: key.publicKey,
      privateKey: encryptSshPrivateKey(key.privateKey),
      passphrase: null,
      description: input.description?.trim() || null,
      createdById: input.createdById ?? null,
      teamId: teamId ?? null,
    },
    select: { id: true, name: true, fingerprint: true, description: true, teamId: true },
  });
}

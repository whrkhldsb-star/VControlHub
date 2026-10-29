import { createHash, createPrivateKey, type KeyObject } from "node:crypto";
import { parseFromString } from "ppk-to-openssh";
import { parsePrivateKey } from "sshpk";
import { utils } from "ssh2";
import type { RoleKey } from "@/lib/auth/rbac";
import { teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { isUniqueViolation, prisma } from "@/lib/db";
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

// The KDF cost of an imported key is read from the uploaded file and derived
// synchronously on the request thread: an unchecked value freezes the whole hub
// (a PPK asking for 2 GiB of Argon2 memory blocks the event loop for minutes).
// PuTTY's default is 8 MiB × 13 passes and `ssh-keygen -a` defaults to 16 rounds.
const PPK_ARGON2_MAX_MEMORY_KIB = 262_144;
const PPK_ARGON2_MAX_PASSES = 64;
const PPK_ARGON2_MAX_PARALLELISM = 16;
const PPK_ARGON2_MAX_COST = 1_024; // MiB × passes
const OPENSSH_BCRYPT_MAX_ROUNDS = 128;

/** bcrypt_pbkdf rounds of an encrypted OpenSSH private key, or null when not stated. */
function openSshBcryptRounds(pem: string): number | null {
  const body = pem.replace(/-----(?:BEGIN|END) OPENSSH PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  let raw: Buffer;
  try { raw = Buffer.from(body, "base64"); } catch { return null; }
  const magic = Buffer.from("openssh-key-v1\0");
  if (raw.length < magic.length + 12 || !raw.subarray(0, magic.length).equals(magic)) return null;
  let offset = magic.length;
  const readString = (): Buffer | null => {
    if (offset + 4 > raw.length) return null;
    const length = raw.readUInt32BE(offset);
    if (offset + 4 + length > raw.length) return null;
    const value = raw.subarray(offset + 4, offset + 4 + length);
    offset += 4 + length;
    return value;
  };
  readString(); // cipher name
  const kdfName = readString();
  const kdfOptions = readString();
  if (!kdfName || !kdfOptions || kdfName.toString() !== "bcrypt") return null;
  // kdfoptions = string salt + uint32 rounds
  if (kdfOptions.length < 8) return null;
  const saltLength = kdfOptions.readUInt32BE(0);
  if (4 + saltLength + 4 > kdfOptions.length) return null;
  return kdfOptions.readUInt32BE(4 + saltLength);
}

function assertImportedKdfCost(content: string) {
  const tooHeavy = () => new ValidationError(t("backend.server.sshKeyKdfTooHeavy"));
  if (content.startsWith("PuTTY-User-Key-File-")) {
    const header = (name: string) => {
      const match = new RegExp(`^${name}:\\s*(\\d+)\\s*$`, "im").exec(content);
      return match ? Number(match[1]) : null;
    };
    const memory = header("Argon2-Memory");
    const passes = header("Argon2-Passes");
    const parallelism = header("Argon2-Parallelism");
    if (memory !== null && memory > PPK_ARGON2_MAX_MEMORY_KIB) throw tooHeavy();
    if (passes !== null && passes > PPK_ARGON2_MAX_PASSES) throw tooHeavy();
    if (parallelism !== null && parallelism > PPK_ARGON2_MAX_PARALLELISM) throw tooHeavy();
    if (memory !== null && passes !== null && (memory / 1024) * passes > PPK_ARGON2_MAX_COST) throw tooHeavy();
  } else if (content.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----")) {
    const rounds = openSshBcryptRounds(content);
    if (rounds !== null && rounds > OPENSSH_BCRYPT_MAX_ROUNDS) throw tooHeavy();
  }
}

export async function normalizeImportedSshKey(input: ImportedKey) {
  const source = input.keyFile?.length ? input.keyFile : input.privateKey?.trim();
  if (!source) throw new ValidationError(t("backend.server.sshPrivateKeyRequired"));
  const passphrase = input.passphrase || undefined; // Spaces are part of a password.
  let content = typeof source === "string" ? source : source.toString("utf8").trim();
  try {
    assertImportedKdfCost(content);
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
  // A fingerprint is stored once. Importing the same key again failed on the
  // unique constraint and showed the database's own message; name the saved
  // key instead (only within this customer: elsewhere, just that it exists).
  const existing = await prisma.sshKey.findUnique({ where: { fingerprint: key.fingerprint }, select: { name: true, teamId: true } });
  if (existing) {
    throw new ValidationError(existing.teamId === (teamId ?? null)
      ? t("backend.server.sshKeyAlreadySaved", { name: existing.name })
      : t("backend.server.sshKeyAlreadyImported"));
  }
  try {
    return await prisma.sshKey.create({
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
  } catch (error) {
    if (isUniqueViolation(error)) throw new ValidationError(t("backend.server.sshKeyAlreadyImported"));
    throw error;
  }
}

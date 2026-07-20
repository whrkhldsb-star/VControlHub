/**
 * Server / SSH-key sub-module (TR-038 R1).
 *
 * Extracted out of `src/lib/server/service.ts` (1120 LOC god-object).
 * This file owns the SSH-key bag end-to-end:
 *
 *   - `listSshKeys()`         — read all stored keys
 *   - `createSshKey(input)`   — accept a public key OR a .ppk blob,
 *                               normalise/validate, derive a SHA-256
 *                               fingerprint and persist
 *
 * The service module re-exports these names unchanged so all 14
 * existing call sites (server actions, route handlers, tests that
 * `vi.mock` the module) keep working without edits.
 *
 * Why split this first: it's a self-contained slice with a clean
 * dependency surface (prisma, ppk-to-openssh, ssh-key-crypto) and zero
 * coupling to server-CRUD / direct-gateway / SSH connectivity logic in
 * service.ts. Splitting it does not change runtime behaviour — the
 * goal of TR-038 is structural, not behavioural.
 */

import { createHash } from "node:crypto";

import { PPKError, parseFromString } from "ppk-to-openssh";

import type { RoleKey } from "@/lib/auth/rbac";
import { teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";

type TeamSession = { userId: string; roles: RoleKey[]; currentTeamId: string | null };

import { encryptSshPrivateKey, encryptSshKeyPassphrase } from "@/lib/ssh/ssh-key-crypto";
import { t } from "@/lib/i18n/translations";

/** Detect SSH private key format from content */
function detectKeyFormat(content: string): "ppk" | "openssh" | "unknown" {
  const trimmed = content.trim();
  if (trimmed.startsWith("PuTTY-User-Key-File")) return "ppk";
  if (trimmed.startsWith("-----BEGIN ") && trimmed.includes("PRIVATE KEY-----")) return "openssh";
  return "unknown";
}

/** Validate OpenSSH/PEM private key has a proper header */
function validateOpenSshPrivateKey(key: string): void {
  const trimmed = key.trim();
  if (!trimmed.startsWith("-----BEGIN ")) {
    throw new ValidationError(t("backend.server.sshPrivateKeyInvalidBegin"));
  }
  if (!trimmed.includes("PRIVATE KEY-----")) {
    throw new ValidationError(t("backend.server.sshPrivateKeyMissingMarker"));
  }
  if (!trimmed.includes("-----END ")) {
    throw new ValidationError(t("backend.server.sshPrivateKeyMissingEnd"));
  }
}

/** Derive a fingerprint from a private key as fallback */
function computeSshPublicKeyFingerprintFromPrivate(privateKey: string): string {
  return `SHA256:${createHash("sha256").update(privateKey.trim()).digest("base64").replace(/=+$/g, "")}`;
}

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

function normalizeAuthorizedKey(input: string) {
  return input.trim().replace(/\r\n/g, "\n");
}

function toBase64UrlSafe(value: string) {
  return value.replace(/-/g, "+").replace(/_/g, "/");
}

function computeSshPublicKeyFingerprint(publicKey: string) {
  const normalized = normalizeAuthorizedKey(publicKey);
  const parts = normalized.split(/\s+/);

  if (parts.length < 2) {
    throw new ValidationError(
      "SSH public key format is invalid; please paste the full authorized_keys public key content.",
    );
  }

  const decoded = Buffer.from(toBase64UrlSafe(parts[1]!), "base64");
  if (decoded.length === 0) {
    throw new ValidationError(t("backend.server.sshPublicKeyUnparseable"));
  }

  return `SHA256:${createHash("sha256").update(decoded).digest("base64").replace(/=+$/g, "")}`;
}

type SshPrivateKeyEncryptionMode = "none" | "same-as-ppk" | "custom";

async function normalizeImportedSshKey(input: {
  publicKey?: string;
  privateKey?: string | null;
  ppkContent?: string | null;
  ppkPassphrase?: string | null;
  privateKeyEncryptionMode?: SshPrivateKeyEncryptionMode;
  privateKeyOutputPassphrase?: string | null;
  passphrase?: string | null;
}) {
  const uploadedContent = input.ppkContent?.trim();
  const manualPrivateKey = input.privateKey?.trim() || null;
  const passphrase = input.passphrase?.trim() || null;

  if (!uploadedContent) {
    const publicKey = normalizeAuthorizedKey(input.publicKey ?? "");
    if (!publicKey && !manualPrivateKey) {
      throw new ValidationError(t("backend.server.sshPublicKeyEmpty"));
    }
    if (manualPrivateKey && manualPrivateKey.startsWith("-----BEGIN")) {
      validateOpenSshPrivateKey(manualPrivateKey);
    }
    return {
      publicKey: publicKey || "",
      privateKey: manualPrivateKey,
      passphrase,
      fingerprint: publicKey
        ? computeSshPublicKeyFingerprint(publicKey)
        : manualPrivateKey
          ? computeSshPublicKeyFingerprintFromPrivate(manualPrivateKey)
          : "",
    };
  }

  const format = detectKeyFormat(uploadedContent);

  if (format === "openssh") {
    validateOpenSshPrivateKey(uploadedContent);
    const publicKey = normalizeAuthorizedKey(input.publicKey ?? "");
    return {
      publicKey: publicKey || "",
      privateKey: uploadedContent,
      passphrase,
      fingerprint: publicKey
        ? computeSshPublicKeyFingerprint(publicKey)
        : computeSshPublicKeyFingerprintFromPrivate(uploadedContent),
    };
  }

  if (format === "unknown") {
    throw new ValidationError(
      "Unrecognized key file format. Supported formats: PuTTY .ppk, OpenSSH, PEM (PKCS#1/PKCS#8/SEC1).",
    );
  }

  // PPK format — existing conversion flow
  const inputPassphrase = input.ppkPassphrase?.trim() ?? "";
  const encryptionMode = input.privateKeyEncryptionMode ?? "none";
  const outputPassphrase = input.privateKeyOutputPassphrase?.trim() ?? "";

  if (encryptionMode === "same-as-ppk" && !inputPassphrase) {
    throw new ValidationError(t("backend.server.ppkPassphraseRequired"));
  }

  if (encryptionMode === "custom" && !outputPassphrase) {
    throw new ValidationError(t("backend.server.customPassphraseRequired"));
  }

  try {
    const parsed =
      encryptionMode === "none"
        ? await parseFromString(uploadedContent, inputPassphrase)
        : await parseFromString(uploadedContent, inputPassphrase, {
            encrypt: true,
            outputPassphrase:
              encryptionMode === "same-as-ppk"
                ? inputPassphrase
                : outputPassphrase,
          });

    return {
      publicKey: normalizeAuthorizedKey(parsed.publicKey),
      privateKey: parsed.privateKey.trim(),
      passphrase: null,
      fingerprint:
        parsed.fingerprint || computeSshPublicKeyFingerprint(parsed.publicKey),
    };
  } catch (error) {
    if (error instanceof PPKError) {
      if (error.code === "PASSPHRASE_REQUIRED") {
        throw new ValidationError(t("backend.server.ppkEncryptedNeedPassphrase"));
      }

      if (error.code === "INVALID_MAC") {
        throw new ValidationError(t("backend.server.ppkPassphraseIncorrect"));
      }

      if (error.code === "WRONG_FORMAT") {
        throw new ValidationError(t("backend.server.theUploadedFileIsNotAValidPpk"));
      }

      throw new ValidationError(error.message);
    }

    throw error;
  }
}

export async function createSshKey(input: {
  name: string;
  publicKey?: string;
  privateKey?: string | null;
  ppkContent?: string | null;
  ppkPassphrase?: string | null;
  privateKeyEncryptionMode?: SshPrivateKeyEncryptionMode;
  privateKeyOutputPassphrase?: string | null;
  passphrase?: string | null;
  description?: string | null;
  createdById?: string | null;
  session?: TeamSession | null;
}) {
  const name = input.name.trim();
  const description = input.description?.trim() || null;

  if (!name) throw new ValidationError(t("backend.server.sshKeyNameRequired"));

  const normalizedKey = await normalizeImportedSshKey(input);

  if (!normalizedKey.fingerprint) {
    throw new ValidationError(t("backend.server.sshFingerprintFailed"));
  }

  const teamId = input.session ? teamCreateData(input.session).teamId : null;

  return prisma.sshKey.create({
    data: {
      name,
      fingerprint: normalizedKey.fingerprint,
      publicKey: normalizedKey.publicKey || "",
      privateKey: normalizedKey.privateKey
        ? encryptSshPrivateKey(normalizedKey.privateKey)
        : null,
      passphrase: normalizedKey.passphrase
        ? encryptSshKeyPassphrase(normalizedKey.passphrase)
        : null,
      description,
      createdById: input.createdById ?? null,
      teamId: teamId ?? null,
    },
    select: {
      id: true,
      name: true,
      fingerprint: true,
      description: true,
      teamId: true,
    },
  });
}

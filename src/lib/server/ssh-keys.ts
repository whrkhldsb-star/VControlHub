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

import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { encryptSshPrivateKey } from "@/lib/ssh/ssh-key-crypto";

export async function listSshKeys() {
  return prisma.sshKey.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, fingerprint: true, description: true },
    take: 500, // P2: ssh key 总数有限
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
      "SSH 公钥格式无效，请粘贴完整的 authorized_keys 公钥内容。",
    );
  }

  const decoded = Buffer.from(toBase64UrlSafe(parts[1]!), "base64");
  if (decoded.length === 0) {
    throw new ValidationError("SSH 公钥内容无法解析，请检查公钥是否完整。");
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
}) {
  const ppkContent = input.ppkContent?.trim();
  const manualPrivateKey = input.privateKey?.trim() || null;

  if (!ppkContent) {
    const publicKey = normalizeAuthorizedKey(input.publicKey ?? "");
    if (!publicKey) {
      throw new ValidationError("SSH 公钥不能为空，或请上传 .ppk 私钥文件自动提取。 ");
    }

    return {
      publicKey,
      privateKey: manualPrivateKey,
      fingerprint: computeSshPublicKeyFingerprint(publicKey),
    };
  }

  const inputPassphrase = input.ppkPassphrase?.trim() ?? "";
  const encryptionMode = input.privateKeyEncryptionMode ?? "none";
  const outputPassphrase = input.privateKeyOutputPassphrase?.trim() ?? "";

  if (encryptionMode === "same-as-ppk" && !inputPassphrase) {
    throw new ValidationError("选择沿用 PPK 口令时，必须填写 PPK 口令。");
  }

  if (encryptionMode === "custom" && !outputPassphrase) {
    throw new ValidationError("选择自定义加密格式时，必须填写新的私钥口令。");
  }

  try {
    const parsed =
      encryptionMode === "none"
        ? await parseFromString(ppkContent, inputPassphrase)
        : await parseFromString(ppkContent, inputPassphrase, {
            encrypt: true,
            outputPassphrase:
              encryptionMode === "same-as-ppk"
                ? inputPassphrase
                : outputPassphrase,
          });

    return {
      publicKey: normalizeAuthorizedKey(parsed.publicKey),
      privateKey: parsed.privateKey.trim(),
      fingerprint:
        parsed.fingerprint || computeSshPublicKeyFingerprint(parsed.publicKey),
    };
  } catch (error) {
    if (error instanceof PPKError) {
      if (error.code === "PASSPHRASE_REQUIRED") {
        throw new ValidationError("该 PPK 文件已加密，请填写正确的 PPK 口令后再导入。");
      }

      if (error.code === "INVALID_MAC") {
        throw new ValidationError("PPK 口令错误或文件已损坏，请检查后重试。");
      }

      if (error.code === "WRONG_FORMAT") {
        throw new ValidationError("上传文件不是有效的 PPK 私钥，请选择 .ppk 文件。 ");
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
  description?: string | null;
  createdById?: string | null;
}) {
  const name = input.name.trim();
  const description = input.description?.trim() || null;

  if (!name) throw new ValidationError("SSH 密钥名称不能为空");

  const normalizedKey = await normalizeImportedSshKey(input);

  return prisma.sshKey.create({
    data: {
      name,
      fingerprint: normalizedKey.fingerprint,
      publicKey: normalizedKey.publicKey,
      privateKey: normalizedKey.privateKey
        ? encryptSshPrivateKey(normalizedKey.privateKey)
        : null,
      description,
      createdById: input.createdById ?? null,
    },
    select: {
      id: true,
      name: true,
      fingerprint: true,
      description: true,
    },
  });
}

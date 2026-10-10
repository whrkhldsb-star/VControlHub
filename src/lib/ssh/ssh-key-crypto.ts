/**
 * Encryption helpers for SSH private keys stored in the database.
 *
 * Strategy:
 * - On write (createSshKey / update): encrypt(privateKey) → store ciphertext
 * - On read (any SSH connection): decryptIfEncrypted(privateKey) → get plaintext for ssh2
 *
 * Encrypted values look like "iv:authTag:ciphertext" (base64 segments separated by colons).
 * Plain-text keys (legacy) lack the two-colon pattern and pass through unchanged,
 * enabling a zero-downtime migration.
 */

import { createHash, createPrivateKey } from "node:crypto";
import { parsePrivateKey } from "sshpk";

import { encrypt, decrypt, isEncrypted } from "@/lib/crypto/service";

/**
 * Prisma projection for every SSH key that will open a connection. Keys
 * imported before 2026-10-08 may still carry a passphrase; selecting only
 * `privateKey` silently broke commands, monitoring, backups and SFTP storage
 * for them while the terminal kept working.
 */
export const SSH_KEY_CREDENTIAL_SELECT = { privateKey: true, passphrase: true } as const;

export type StoredSshKey = { privateKey?: string | null; passphrase?: string | null };

const SERVER_PASSWORD_PREFIX = "enc:v1:";

function stripServerPasswordPrefix(value: string): string {
	return value.startsWith(SERVER_PASSWORD_PREFIX) ? value.slice(SERVER_PASSWORD_PREFIX.length) : value;
}

/** Encrypt a server login password before database storage. */
export function encryptServerPassword(plainPassword: string): string {
	return `${SERVER_PASSWORD_PREFIX}${encrypt(plainPassword)}`;
}

/**
 * Decrypt a server login password retrieved from the database.
 * Legacy plain-text passwords pass through unchanged for zero-downtime reads.
 */
export function decryptServerPassword(storedPassword: string): string {
	const payload = stripServerPasswordPrefix(storedPassword);
	if (isEncrypted(payload)) {
		return decrypt(payload);
	}
	return storedPassword;
}

/** Detect whether a server password has already been encrypted by this app. */
export function isEncryptedServerPassword(value: string): boolean {
	return value.startsWith(SERVER_PASSWORD_PREFIX) && isEncrypted(stripServerPasswordPrefix(value));
}

/** Encrypt only when a value is still legacy plain text. */
export function encryptServerPasswordIfPlain(value: string): string {
	return isEncryptedServerPassword(value) ? value : encryptServerPassword(value);
}

/** Encrypt a private key before database storage. */
export function encryptSshPrivateKey(plainKey: string): string {
	return encrypt(plainKey);
}

/**
 * Decrypt a private key retrieved from the database.
 * If the value is not encrypted (legacy data), it passes through unchanged.
 */
export function decryptSshPrivateKey(storedKey: string): string {
	if (isEncrypted(storedKey)) {
		return decrypt(storedKey);
	}
	return storedKey;
}

/** Encrypt an SSH key passphrase before database storage. */
export function encryptSshKeyPassphrase(plain: string): string {
	return encrypt(plain);
}

/**
 * Decrypt an SSH key passphrase retrieved from the database.
 * Returns undefined if no passphrase is stored.
 * Legacy plain-text passphrases pass through unchanged.
 */
export function decryptSshKeyPassphrase(stored: string | null | undefined): string | undefined {
	if (!stored) return undefined;
	if (isEncrypted(stored)) return decrypt(stored);
	return stored;
}

const UNLOCKED_KEY_CACHE_LIMIT = 64;
const unlockedKeys = new Map<string, string>();

function unlockPrivateKey(privateKey: string, passphrase: string): string {
	let content = privateKey.trim();
	if (content.startsWith("-----BEGIN ") && !content.startsWith("-----BEGIN OPENSSH ")) {
		// Encrypted PKCS#8 and legacy PEM ciphers are OpenSSL formats.
		content = createPrivateKey({ key: content, passphrase }).export({ format: "pem", type: "pkcs8" }).toString();
	}
	return parsePrivateKey(content, "auto", { passphrase }).toString("openssh");
}

/**
 * Decrypt a stored key into material every SSH client can use without a
 * prompt: the ssh2 library, and the OpenSSH CLI that runs commands with
 * `BatchMode=yes`. Passphrase-protected legacy keys are unlocked once per
 * process (the OpenSSH bcrypt KDF costs ~100 ms of blocking CPU) and cached by
 * ciphertext, so a re-imported key never reuses a stale entry. When the format
 * cannot be unlocked here, the passphrase is returned for ssh2 to try.
 */
export function decryptStoredSshKey(key: StoredSshKey | null | undefined): { privateKey: string; passphrase?: string } | null {
	if (!key?.privateKey) return null;
	const privateKey = decryptSshPrivateKey(key.privateKey);
	const passphrase = decryptSshKeyPassphrase(key.passphrase);
	if (!passphrase) return { privateKey };

	const cacheKey = createHash("sha256").update(key.privateKey).update("\0").update(key.passphrase ?? "").digest("hex");
	const cached = unlockedKeys.get(cacheKey);
	if (cached) return { privateKey: cached };
	try {
		const unlocked = unlockPrivateKey(privateKey, passphrase);
		if (unlockedKeys.size >= UNLOCKED_KEY_CACHE_LIMIT) unlockedKeys.delete(unlockedKeys.keys().next().value!);
		unlockedKeys.set(cacheKey, unlocked);
		return { privateKey: unlocked };
	} catch {
		return { privateKey, passphrase };
	}
}

/** Test-only: forget unlocked keys. */
export function clearUnlockedSshKeyCacheForTests() {
	unlockedKeys.clear();
}

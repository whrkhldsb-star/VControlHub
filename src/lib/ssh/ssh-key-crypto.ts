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

import { encrypt, decrypt, isEncrypted } from "@/lib/crypto/service";

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

/**
 * Type-safe wrapper: decrypt the privateKey field of an SSH key object
 * if present and encrypted.
 */
export function decryptSshKeyField<T extends { privateKey?: string | null }>(
	key: T | null | undefined,
): (T & { privateKey: string | null }) | null {
	if (!key) return null;
	return {
		...key,
		privateKey: key.privateKey ? decryptSshPrivateKey(key.privateKey) : null,
	};
}

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { createLogger } from "@/lib/logging";
import { config } from "@/lib/config/env";

const logger = createLogger("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
/** Per-ciphertext random salt length (bytes). Embedded in the envelope. */
const SALT_LENGTH = 16;
/** Historical global salt used by pre-envelope ciphertext (3-segment format). */
const LEGACY_SALT = "salt-vps-platform";

function getPassphrase(): string {
	// 优先走 config 模块（生产强制 ENCRYPTION_KEY 必填）；开发环境兜底生成。
	if (config.isProduction) {
		return config.crypto.encryptionKey; // 缺失会 throw "Missing required env var: ENCRYPTION_KEY"
	}
	const existing = config.crypto.encryptionKeyOptional;
	if (existing) return existing;
	// Auto-generate for development
	const generated = randomBytes(32).toString("hex");
	process.env.ENCRYPTION_KEY = generated;
	logger.warn("ENCRYPTION_KEY not set, auto-generated for development. Set it in .env for persistence.");
	return generated;
}

function deriveKey(passphrase: string, salt: Buffer | string): Buffer {
	return scryptSync(passphrase, salt, 32);
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns "salt:iv:authTag:ciphertext" (all base64). Each encryption uses a
 * unique random salt so identical passphrases no longer collapse to one key.
 */
export function encrypt(plaintext: string): string {
	const passphrase = getPassphrase();
	const salt = randomBytes(SALT_LENGTH);
	const key = deriveKey(passphrase, salt);
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return `${salt.toString("base64")}:${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * Decrypt a string encrypted by encrypt().
 * Accepts the current 4-segment envelope ("salt:iv:authTag:ciphertext") and
 * the legacy 3-segment format ("iv:authTag:ciphertext") that used a fixed salt.
 */
export function decrypt(ciphertext: string): string {
	const passphrase = getPassphrase();
	const parts = ciphertext.split(":");
	let salt: Buffer | string;
	let ivB64: string | undefined;
	let tagB64: string | undefined;
	let dataB64: string | undefined;

	if (parts.length === 4) {
		const [saltB64, iv, tag, data] = parts;
		if (!saltB64 || !iv || !tag || !data) throw new Error("Invalid encrypted format");
		salt = Buffer.from(saltB64, "base64");
		if (salt.length < SALT_LENGTH) throw new Error("Invalid encrypted format");
		ivB64 = iv;
		tagB64 = tag;
		dataB64 = data;
	} else if (parts.length === 3) {
		// Legacy envelopes: global fixed salt.
		salt = LEGACY_SALT;
		[ivB64, tagB64, dataB64] = parts;
	} else {
		throw new Error("Invalid encrypted format");
	}

	if (!ivB64 || !tagB64 || !dataB64) throw new Error("Invalid encrypted format");
	const key = deriveKey(passphrase, salt);
	const iv = Buffer.from(ivB64, "base64");
	const authTag = Buffer.from(tagB64, "base64");
	const data = Buffer.from(dataB64, "base64");
	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(authTag);
	return decipher.update(data) + decipher.final("utf8");
}

/** Check if a string looks like it was encrypted by our encrypt() function */
export function isEncrypted(value: string): boolean {
	const parts = value.split(":");
	if (parts.length === 3) {
		return /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(value);
	}
	if (parts.length === 4) {
		// New envelope: require a salt that decodes to at least SALT_LENGTH bytes
		// so short garbage like "only:one:colon:extra" is not treated as ciphertext.
		try {
			if (Buffer.from(parts[0]!, "base64").length < SALT_LENGTH) return false;
		} catch {
			return false;
		}
		return /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(value);
	}
	return false;
}

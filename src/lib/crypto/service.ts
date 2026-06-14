import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { createLogger } from "@/lib/logging";
import { config } from "@/lib/config/env";

const logger = createLogger("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
	const key = process.env.ENCRYPTION_KEY;
	if (!key) {
		if (config.isProduction) {
			throw new Error("ENCRYPTION_KEY environment variable is required in production");
		}
		// Auto-generate for development
		const generated = randomBytes(32).toString("hex");
		process.env.ENCRYPTION_KEY = generated;
		logger.warn("ENCRYPTION_KEY not set, auto-generated for development. Set it in .env for persistence.");
		return scryptSync(generated, "salt-vps-platform", 32);
	}
	return scryptSync(key, "salt-vps-platform", 32);
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns "iv:authTag:ciphertext" (all base64).
 */
export function encrypt(plaintext: string): string {
	const key = getEncryptionKey();
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * Decrypt a string encrypted by encrypt().
 * Expects "iv:authTag:ciphertext" format.
 */
export function decrypt(ciphertext: string): string {
	const key = getEncryptionKey();
	const [ivB64, tagB64, dataB64] = ciphertext.split(":");
	if (!ivB64 || !tagB64 || !dataB64) throw new Error("Invalid encrypted format");
	const iv = Buffer.from(ivB64, "base64");
	const authTag = Buffer.from(tagB64, "base64");
	const data = Buffer.from(dataB64, "base64");
	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(authTag);
	return decipher.update(data) + decipher.final("utf8");
}

/** Check if a string looks like it was encrypted by our encrypt() function */
export function isEncrypted(value: string): boolean {
	return /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(value);
}

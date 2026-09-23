/**
 * JSON-credential envelope helpers (TR: one copy; ITSM and cloud-billing used
 * to duplicate these verbatim).
 *
 * The shape shared by every "credentialsEnc" column: the credentials object is
 * JSON-stringified and passed through encrypt()/decrypt() from ./service.
 * Kept in a module of its own (rather than ./service) so tests that mock
 * "@/lib/crypto/service" with their own encrypt/decrypt keep working — this
 * module resolves the base functions through the mock.
 *
 * Verification error surfaces stay caller-specific — each caller passes its
 * own translated "stored credentials are corrupt" message so the API response
 * keeps the right user-facing copy.
 */
import { ValidationError } from "@/lib/errors";

import { decrypt, encrypt, isEncrypted } from "./service";

/** Encrypt a credentials object to its at-rest string form. */
export function encryptJsonCredentials<T>(creds: T | null | undefined): string {
	return encrypt(JSON.stringify(creds ?? {}));
}

/**
 * Decrypt a stored credentials string back to an object. Accepts pre-encryption
 * plaintext (isEncrypted gate) for rows written before the column was
 * encrypted. Throws ValidationError(`corruptMessage`) when the decrypted value
 * is not a JSON object.
 */
export function decryptJsonCredentials<T>(enc: string, corruptMessage: string): T {
	const plain = isEncrypted(enc) ? decrypt(enc) : enc;
	try {
		const parsed = JSON.parse(plain) as T;
		return parsed && typeof parsed === "object" ? parsed : ({} as T);
	} catch {
		throw new ValidationError(corruptMessage);
	}
}

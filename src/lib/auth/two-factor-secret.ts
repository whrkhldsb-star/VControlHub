/**
 * TOTP seed at-rest helpers.
 *
 * Secrets are AES-GCM sealed via ENCRYPTION_KEY (same stack as settings/SSH
 * credentials). Reads accept legacy plaintext rows so existing installs keep
 * working until the next enable/rotate path rewrites the column.
 */
import { decrypt, encrypt, isEncrypted } from "@/lib/crypto/service";

/** Seal a freshly verified TOTP seed before persisting to User.twoFactorSecret. */
export function sealTwoFactorSecret(plaintext: string): string {
	return encrypt(plaintext);
}

/**
 * Open a stored TOTP seed for verification.
 * Legacy plaintext values (no iv:tag:ct envelope) pass through unchanged.
 */
export function openTwoFactorSecret(stored: string): string {
	if (!stored) return stored;
	if (isEncrypted(stored)) return decrypt(stored);
	return stored;
}

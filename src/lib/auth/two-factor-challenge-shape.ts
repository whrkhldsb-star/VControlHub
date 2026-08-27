/**
 * Format-only helpers for second-factor input, shared by the API routes and the
 * account-security panel.
 *
 * Deliberately free of `node:crypto`, Prisma and config imports so the client
 * component can gate its submit button on exactly the shapes the server
 * accepts, instead of hard-coding "6 digits" and locking recovery-code users out
 * of the disable / regenerate flows. See `two-factor-challenge.ts` for the
 * verification itself.
 */
export const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const RECOVERY_CODE_LENGTH = 12;

const RECOVERY_CODE_PATTERN = new RegExp(
  `^[${RECOVERY_CODE_ALPHABET}]{${RECOVERY_CODE_LENGTH}}$`,
);

/** Remove separators and normalize a human-entered recovery code. */
export function normalizeTwoFactorRecoveryCode(value: string): string | null {
  // Be forgiving about the separators shown in the UI, but do not silently
  // discard other characters.  Stripping arbitrary input here would make a
  // valid code with an accidental character inserted still authenticate.
  const normalized = value.trim().toUpperCase().replace(/[\s-]/g, "");
  return RECOVERY_CODE_PATTERN.test(normalized) ? normalized : null;
}

/** A 6-digit authenticator code. */
export function isTotpCodeShape(code: string): boolean {
  return /^\d{6}$/.test(code.trim());
}

/** True when the input has the SHAPE of a recovery code — not that it matches one. */
export function isRecoveryCodeShape(code: string): boolean {
  return normalizeTwoFactorRecoveryCode(code) !== null;
}

/** Either factor. Anything else is rejected before any secret is touched. */
export function isAcceptableTwoFactorCodeShape(code: string): boolean {
  return isTotpCodeShape(code) || isRecoveryCodeShape(code);
}

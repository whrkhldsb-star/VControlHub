import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import { config } from "@/lib/config/env";

import {
  normalizeTwoFactorRecoveryCode,
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_LENGTH,
} from "./two-factor-challenge-shape";

const RECOVERY_CODE_COUNT = 10;

// Re-exported so existing importers keep a single entry point for recovery-code
// handling; the definition lives in the client-safe shape module.
export { normalizeTwoFactorRecoveryCode };

function getRecoveryCodeSigningSecret(): string {
  const configured = config.auth.sessionSecret;
  if (configured) return configured;
  if (config.isProduction) {
    throw new Error("AUTH_SESSION_SECRET must be set in production before enabling two-factor recovery codes");
  }
  return "dev-only-session-secret-change-me";
}

function formatRecoveryCode(value: string): string {
  return value.match(/.{1,4}/g)?.join("-") ?? value;
}

function hashNormalizedRecoveryCode(value: string): string {
  return createHmac("sha256", getRecoveryCodeSigningSecret())
    .update(`vcontrolhub:2fa-recovery:${value}`)
    .digest("base64url");
}

/** Generate display-only codes plus the irreversible values stored in the DB. */
export function createTwoFactorRecoveryCodes(count = RECOVERY_CODE_COUNT): {
  codes: string[];
  hashes: string[];
} {
  const rawCodes = new Set<string>();
  while (rawCodes.size < count) {
    let raw = "";
    for (let index = 0; index < RECOVERY_CODE_LENGTH; index += 1) {
      raw += RECOVERY_CODE_ALPHABET[randomInt(RECOVERY_CODE_ALPHABET.length)]!;
    }
    rawCodes.add(raw);
  }
  const codes = [...rawCodes].map(formatRecoveryCode);
  return { codes, hashes: codes.map((code) => hashNormalizedRecoveryCode(code.replaceAll("-", ""))) };
}

/**
 * Return the stored hash that matched this code. The caller deletes that hash
 * atomically, making every recovery code single-use.
 */
export function findMatchingTwoFactorRecoveryCode(
  code: string,
  storedHashes: unknown,
): string | null {
  const normalized = normalizeTwoFactorRecoveryCode(code);
  if (!normalized || !Array.isArray(storedHashes)) return null;
  const candidate = Buffer.from(hashNormalizedRecoveryCode(normalized), "utf8");
  for (const stored of storedHashes) {
    if (typeof stored !== "string") continue;
    const expected = Buffer.from(stored, "utf8");
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return stored;
    }
  }
  return null;
}

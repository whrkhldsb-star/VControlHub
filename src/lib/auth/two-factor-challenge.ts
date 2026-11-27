/**
 * Second-factor challenge shared by every endpoint that re-authenticates an
 * account with "something you have".
 *
 * A recovery code and an authenticator code are interchangeable by design —
 * `/api/auth/2fa/verify-login` accepts either to mint a full session. Anything
 * that accepts ONLY a TOTP code therefore creates a dead end: a user who has
 * lost their authenticator can still sign in with a recovery code, but could
 * not disable 2FA, could not regenerate recovery codes and could not re-run
 * setup (that route refuses while 2FA is on). No admin path resets another
 * account's 2FA either, so the account became permanently unreachable once its
 * recovery codes ran out. Routing all three through this helper closes that.
 */
import type { Prisma } from "@prisma/client";
import { verify as verifyTOTP } from "otplib";

import { prisma } from "@/lib/db";
import { DB_UTC_NOW } from "@/lib/db/utc-now";

import {
  isRecoveryCodeShape,
  isTotpCodeShape,
} from "./two-factor-challenge-shape";
import { findMatchingTwoFactorRecoveryCode } from "./two-factor-recovery";
import { openTwoFactorSecret } from "./two-factor-secret";

export { isAcceptableTwoFactorCodeShape } from "./two-factor-challenge-shape";

export type TwoFactorChallengeResult = {
  valid: boolean;
  /** True only when a one-use recovery code was consumed to pass the challenge. */
  usedRecoveryCode: boolean;
};

/**
 * Verify a second factor, consuming the recovery code if that is what was used.
 *
 * PostgreSQL removes just the matched fingerprint from the current array.
 */
export async function verifyTwoFactorChallenge(input: {
  userId: string;
  code: string;
  /** The sealed (or legacy plaintext) TOTP seed from the user row. */
  sealedSecret: string;
  /** `user.twoFactorRecoveryCodes` as stored — an array of HMAC fingerprints. */
  storedRecoveryCodes: unknown;
}, db: Prisma.TransactionClient = prisma): Promise<TwoFactorChallengeResult> {
  if (isTotpCodeShape(input.code)) {
    const totp = await verifyTOTP({
      token: input.code.trim(),
      secret: openTwoFactorSecret(input.sealedSecret),
    });
    if (totp.valid && "timeStep" in totp && Number.isSafeInteger(totp.timeStep)) {
      // Verify cryptographically first, then consume with one database CAS.
      // A concurrent attempt, another process, or an old credential snapshot
      // cannot spend the same step twice (nor authenticate after rotation).
      const consumed = await db.user.updateMany({
        where: {
          id: input.userId,
          status: { not: "DISABLED" },
          twoFactorEnabled: true,
          twoFactorSecret: input.sealedSecret,
          OR: [{ lastAcceptedTotpStep: null }, { lastAcceptedTotpStep: { lt: totp.timeStep } }],
        },
        data: { lastAcceptedTotpStep: totp.timeStep },
      });
      return { valid: consumed.count === 1, usedRecoveryCode: false };
    }
  }

  if (!isRecoveryCodeShape(input.code)) return { valid: false, usedRecoveryCode: false };
  const matchingHash = findMatchingTwoFactorRecoveryCode(
    input.code,
    input.storedRecoveryCodes,
  );
  if (!matchingHash) return { valid: false, usedRecoveryCode: false };
  const consumed = await db.$executeRaw`
    UPDATE "User" SET "twoFactorRecoveryCodes" = "twoFactorRecoveryCodes" - ${matchingHash}::text, "updatedAt" = ${DB_UTC_NOW}
    WHERE id = ${input.userId} AND status <> 'DISABLED' AND "twoFactorEnabled"
      AND "twoFactorSecret" = ${input.sealedSecret} AND jsonb_typeof("twoFactorRecoveryCodes") = 'array'
      AND "twoFactorRecoveryCodes" ? ${matchingHash}::text`;
  return { valid: consumed === 1, usedRecoveryCode: consumed === 1 };
}

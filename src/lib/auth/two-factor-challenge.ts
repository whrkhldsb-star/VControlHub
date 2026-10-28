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
import { verify as verifyTOTP } from "otplib";

import { prisma } from "@/lib/db";

import {
  isRecoveryCodeShape,
  isTotpCodeShape,
} from "./two-factor-challenge-shape";
import { findMatchingTwoFactorRecoveryCode } from "./two-factor-recovery";
import { openTwoFactorSecret } from "./two-factor-secret";

export { isAcceptableTwoFactorCodeShape } from "./two-factor-challenge-shape";

/**
 * The newest 30-second step each account has already spent. A code is valid for its own step (and a
 * neighbour for clock drift), so without this a code seen once — over a shoulder, in a proxy log — could be
 * presented again within the window. In memory: login runs in the web process and the window is 30 s.
 */
const lastAcceptedTotpStep = new Map<string, number>();
const MAX_TRACKED_ACCOUNTS = 10_000;

function rememberAcceptedStep(userId: string, timeStep: number) {
  if (!lastAcceptedTotpStep.has(userId) && lastAcceptedTotpStep.size >= MAX_TRACKED_ACCOUNTS) {
    const oldest = lastAcceptedTotpStep.keys().next().value;
    if (oldest !== undefined) lastAcceptedTotpStep.delete(oldest);
  }
  lastAcceptedTotpStep.set(userId, timeStep);
}

export type TwoFactorChallengeResult = {
  valid: boolean;
  /** True only when a one-use recovery code was consumed to pass the challenge. */
  usedRecoveryCode: boolean;
};

/**
 * Verify a second factor, consuming the recovery code if that is what was used.
 *
 * Consumption is a compare-and-set on the whole stored array, so two concurrent
 * requests presenting the same code cannot both succeed.
 */
export async function verifyTwoFactorChallenge(input: {
  userId: string;
  code: string;
  /** The sealed (or legacy plaintext) TOTP seed from the user row. */
  sealedSecret: string;
  /** `user.twoFactorRecoveryCodes` as stored — an array of HMAC fingerprints. */
  storedRecoveryCodes: unknown;
}): Promise<TwoFactorChallengeResult> {
  if (isTotpCodeShape(input.code)) {
    const totp = await verifyTOTP({
      token: input.code.trim(),
      secret: openTwoFactorSecret(input.sealedSecret),
      afterTimeStep: lastAcceptedTotpStep.get(input.userId),
    });
    if (totp.valid) {
      if (typeof totp.timeStep === "number") rememberAcceptedStep(input.userId, totp.timeStep);
      return { valid: true, usedRecoveryCode: false };
    }
  }

  if (!isRecoveryCodeShape(input.code)) return { valid: false, usedRecoveryCode: false };
  const matchingHash = findMatchingTwoFactorRecoveryCode(
    input.code,
    input.storedRecoveryCodes,
  );
  if (!matchingHash || !Array.isArray(input.storedRecoveryCodes)) {
    return { valid: false, usedRecoveryCode: false };
  }

  const remainingHashes = input.storedRecoveryCodes.filter(
    (hash): hash is string => typeof hash === "string" && hash !== matchingHash,
  );
  const consumed = await prisma.user.updateMany({
    where: {
      id: input.userId,
      twoFactorRecoveryCodes: { equals: input.storedRecoveryCodes },
    },
    data: { twoFactorRecoveryCodes: remainingHashes },
  });
  const valid = consumed.count === 1;
  return { valid, usedRecoveryCode: valid };
}

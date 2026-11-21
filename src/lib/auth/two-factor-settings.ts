import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { lockUserRow } from "@/lib/user/row-lock";
import { checkSecurityChallenge } from "./security-challenge-budget";
import { verifyTwoFactorChallenge } from "./two-factor-challenge";
import { AuthError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { assertSessionCredentialBinding, captureSessionCredentialBinding, type SessionPayload } from "./session";

type TwoFactorCredentialSnapshot = {
  passwordHash: string;
  sessionEpoch: number;
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
};

type FactorUpdate = Pick<Prisma.UserUpdateManyMutationInput, "twoFactorEnabled" | "twoFactorSecret" | "twoFactorRecoveryCodes" | "lastAcceptedTotpStep">;

/** Spending a one-use factor and committing the authorized change must succeed together. */
export async function changeTwoFactorWithProof<T>(
  session: SessionPayload, code: string, mutation: () => { data: FactorUpdate; value: T },
) {
  const result = await checkSecurityChallenge(session.userId, () => prisma.$transaction(async tx => {
    await lockUserRow(tx, session.userId);
    const user = await tx.user.findUnique({
      where: { id: session.userId },
      select: { passwordHash: true, sessionEpoch: true, status: true, twoFactorEnabled: true, twoFactorSecret: true, twoFactorRecoveryCodes: true },
    });
    if (!user || user.status === "DISABLED") throw new AuthError(t("backend.auth.sessionCredentialsChanged"));
    assertSessionCredentialBinding(session, user);
    if (!user.twoFactorEnabled || !user.twoFactorSecret) throw new ValidationError(t("api.auth.twoFactor.notEnabled"));
    const proof = await verifyTwoFactorChallenge({
      userId: session.userId, code, sealedSecret: user.twoFactorSecret, storedRecoveryCodes: user.twoFactorRecoveryCodes,
    }, tx);
    if (!proof.valid) return null;
    const { data, value } = mutation();
    const credentialBinding = await updateTwoFactorCredentials(session, user, data, tx);
    return { credentialBinding, usedRecoveryCode: proof.usedRecoveryCode, value };
  }), changed => changed !== null);
  if (!result) throw new ValidationError(t("api.auth.twoFactor.invalidCode"));
  return result;
}

/** Change only the factor state that was verified, retiring old sessions atomically. */
export async function updateTwoFactorCredentials(
  session: SessionPayload,
  verified: TwoFactorCredentialSnapshot,
  data: FactorUpdate,
  db: Prisma.TransactionClient = prisma,
) {
  // A revocation can land after the API guard but before the credential read.
  // That newer database snapshot must not refresh the revoked caller's cookie.
  assertSessionCredentialBinding(session, verified);
  const changed = await db.user.updateMany({
    where: {
      id: session.userId,
      passwordHash: verified.passwordHash,
      sessionEpoch: verified.sessionEpoch,
      status: { not: "DISABLED" },
      twoFactorEnabled: verified.twoFactorEnabled,
      twoFactorSecret: verified.twoFactorSecret,
    },
    data: { ...data, sessionEpoch: { increment: 1 } },
  });
  if (changed.count !== 1) {
    throw new AuthError(t("backend.auth.sessionCredentialsChanged"));
  }
  // Carry the exact state installed by this operation through cookie minting.
  // Re-reading a newer epoch would bless a concurrent reset we never proved.
  return captureSessionCredentialBinding({
    passwordHash: verified.passwordHash,
    sessionEpoch: verified.sessionEpoch + 1,
  });
}

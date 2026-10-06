import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { AuthError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { assertSessionCredentialBinding, captureSessionCredentialBinding, type SessionPayload } from "./session";

type TwoFactorCredentialSnapshot = {
  passwordHash: string;
  sessionEpoch: number;
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
};

/** Change only the factor state that was verified, retiring old sessions atomically. */
export async function updateTwoFactorCredentials(
  session: SessionPayload,
  verified: TwoFactorCredentialSnapshot,
  data: Pick<Prisma.UserUpdateManyMutationInput, "twoFactorEnabled" | "twoFactorSecret" | "twoFactorRecoveryCodes">,
) {
  // A revocation can land after the API guard but before the credential read.
  // That newer database snapshot must not refresh the revoked caller's cookie.
  assertSessionCredentialBinding(session, verified);
  const changed = await prisma.user.updateMany({
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

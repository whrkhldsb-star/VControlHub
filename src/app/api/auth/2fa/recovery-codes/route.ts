/**
 * Regenerate single-use 2FA recovery codes for the current account.
 * A live second factor is required so a stolen browser session cannot replace
 * an account's last-resort recovery path. One of the account's own recovery
 * codes counts as that factor (and is consumed) — otherwise a user whose
 * authenticator is gone could never top the set back up, and would be locked
 * out for good once the last code was spent.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  isAcceptableTwoFactorCodeShape,
  verifyTwoFactorChallenge,
} from "@/lib/auth/two-factor-challenge";
import { createTwoFactorRecoveryCodes } from "@/lib/auth/two-factor-recovery";
import { auditUserAction } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { getServerLocale, t } from "@/lib/i18n/translations";

// Shape is checked in the handler: an authenticator code and a recovery code
// have different formats, and rejecting one of them here would hard-code the
// dead end this route exists to avoid.
const regenerateSchema = z.object({ code: z.string().min(1) });

export async function POST(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: t("api.auth.twoFactor.enableFailed", locale),
      bodySchema: regenerateSchema,
    },
    async ({ session, body }) => {
      if (!session) {
        return NextResponse.json(
          { error: t("api.auth.sessionExpired", locale) },
          { status: 401 },
        );
      }

      if (!isAcceptableTwoFactorCodeShape(body.code)) {
        throw new ValidationError(t("api.auth.twoFactor.invalidCode", locale));
      }

      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: {
          twoFactorEnabled: true,
          twoFactorSecret: true,
          twoFactorRecoveryCodes: true,
        },
      });
      if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
        throw new ValidationError(t("api.auth.twoFactor.notEnabled", locale));
      }
      const challenge = await verifyTwoFactorChallenge({
        userId: session.userId,
        code: body.code,
        sealedSecret: user.twoFactorSecret,
        storedRecoveryCodes: user.twoFactorRecoveryCodes,
      });
      if (!challenge.valid) {
        throw new ValidationError(t("api.auth.twoFactor.invalidCode", locale));
      }

      const recovery = createTwoFactorRecoveryCodes();
      await prisma.user.update({
        where: { id: session.userId },
        data: { twoFactorRecoveryCodes: recovery.hashes },
      });
      await auditUserAction(
        session.userId,
        "auth.2fa.recovery_codes_regenerated",
        { userId: session.userId, usedRecoveryCode: challenge.usedRecoveryCode },
        "WARNING",
        session.currentTeamId,
      );

      return NextResponse.json({ success: true, recoveryCodes: recovery.codes });
    },
  );
}

/**
 * Regenerate single-use 2FA recovery codes for the current account.
 * A live authenticator code is required so a stolen browser session cannot
 * replace an account's last-resort recovery path.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { verify as verifyTOTP } from "otplib";

import { openTwoFactorSecret } from "@/lib/auth/two-factor-secret";
import { createTwoFactorRecoveryCodes } from "@/lib/auth/two-factor-recovery";
import { auditUserAction } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { getServerLocale, t } from "@/lib/i18n/translations";

const regenerateSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

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

      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { twoFactorEnabled: true, twoFactorSecret: true },
      });
      if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
        throw new ValidationError(t("api.auth.twoFactor.notEnabled", locale));
      }
      if (!(await verifyTOTP({ token: body.code, secret: openTwoFactorSecret(user.twoFactorSecret) })).valid) {
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
        { userId: session.userId },
        "WARNING",
        session.currentTeamId,
      );

      return NextResponse.json({ success: true, recoveryCodes: recovery.codes });
    },
  );
}

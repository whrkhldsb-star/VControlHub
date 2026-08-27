/**
 * 2FA Disable — verify the current second factor, then disable 2FA.
 * POST /api/auth/2fa/disable  { code }
 *
 * `code` is an authenticator code OR one of the account's recovery codes. A
 * recovery code has to be accepted here: it is enough to sign in, and this is
 * the only self-service way off 2FA once the authenticator device is gone.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import {
  isAcceptableTwoFactorCodeShape,
  verifyTwoFactorChallenge,
} from "@/lib/auth/two-factor-challenge";
import { auditUserAction } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { getServerLocale, t } from "@/lib/i18n/translations";

import { ValidationError } from "@/lib/errors";
const disableSchema = z.object({ code: z.string().min(1) });

export async function POST(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: t("api.auth.twoFactor.disableFailed", locale),
      bodySchema: disableSchema,
    },
    async ({ session, body }) => {
      if (!session)
        return NextResponse.json(
          { error: t("api.auth.sessionExpired", locale) },
          { status: 401 },
        );

      const { code } = body;

      if (!isAcceptableTwoFactorCodeShape(code)) {
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
        code,
        sealedSecret: user.twoFactorSecret,
        storedRecoveryCodes: user.twoFactorRecoveryCodes,
      });
      if (!challenge.valid) {
        throw new ValidationError(t("api.auth.twoFactor.invalidCode", locale));
      }

      await prisma.user.update({
        where: { id: session.userId },
        data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecoveryCodes: Prisma.DbNull },
      });

      await auditUserAction(
        session.userId,
        "auth.2fa.disable",
        { userId: session.userId, usedRecoveryCode: challenge.usedRecoveryCode },
        "INFO",
        session.currentTeamId,
      );

      return NextResponse.json({ success: true });
    },
  );
}

/**
 * 2FA Disable — verify current TOTP code, then disable 2FA.
 * POST /api/auth/2fa/disable  { code }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { verify as verifyTOTP } from "otplib";

import { openTwoFactorSecret } from "@/lib/auth/two-factor-secret";
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

      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { twoFactorEnabled: true, twoFactorSecret: true },
      });

      if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
        throw new ValidationError(t("api.auth.twoFactor.notEnabled", locale));
      }

      const valid = verifyTOTP({ token: code, secret: openTwoFactorSecret(user.twoFactorSecret) });
      if (!valid) {
        throw new ValidationError(t("api.auth.twoFactor.invalidCode", locale));
      }

      await prisma.user.update({
        where: { id: session.userId },
        data: { twoFactorEnabled: false, twoFactorSecret: null },
      });

      await auditUserAction(
        session.userId,
        "auth.2fa.disable",
        { userId: session.userId },
        "INFO",
        session.currentTeamId,
      );

      return NextResponse.json({ success: true });
    },
  );
}

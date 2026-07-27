/**
 * 2FA Enable — after verifying the TOTP code, saves the secret to DB.
 * POST /api/auth/2fa/enable  { code, secret }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { verify as verifyTOTP } from "otplib";

import { sealTwoFactorSecret } from "@/lib/auth/two-factor-secret";
import { auditUserAction } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { getServerLocale, t } from "@/lib/i18n/translations";

import { ValidationError } from "@/lib/errors";
const enableSchema = z.object({
  code: z.string().min(1),
  secret: z.string().min(1),
});

export async function POST(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: t("api.auth.twoFactor.enableFailed", locale),
      bodySchema: enableSchema,
    },
    async ({ session, body }) => {
      if (!session)
        return NextResponse.json(
          { error: t("api.auth.sessionExpired", locale) },
          { status: 401 },
        );

      const { code, secret } = body;

      // Refuse to overwrite an already-enabled 2FA secret. Re-setup requires
      // disable (with a valid current TOTP) first so a stolen session cannot
      // silently replace the authenticator seed.
      const existing = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { twoFactorEnabled: true, twoFactorSecret: true },
      });
      if (existing?.twoFactorEnabled && existing.twoFactorSecret) {
        return NextResponse.json(
          {
            error: t("api.auth.twoFactor.alreadyEnabled", locale),
          },
          { status: 400 },
        );
      }

      const valid = verifyTOTP({ token: code, secret });
      if (!valid) {
        throw new ValidationError(t("api.auth.twoFactor.invalidCode", locale));
      }

      // Encrypt at rest — DB dumps / backups must not yield usable TOTP seeds.
      await prisma.user.update({
        where: { id: session.userId },
        data: { twoFactorEnabled: true, twoFactorSecret: sealTwoFactorSecret(secret) },
      });

      await auditUserAction(
        session.userId,
        "auth.2fa.enable",
        { userId: session.userId },
        "INFO",
        session.currentTeamId,
      );

      return NextResponse.json({ success: true });
    },
  );
}

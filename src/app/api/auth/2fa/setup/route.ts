/**
 * 2FA/TOTP Setup — generates a new TOTP secret, otpauth URL, and local QR data URL.
 * POST /api/auth/2fa/setup — generate secret + offline QR (no third-party image host)
 * PUT  /api/auth/2fa/setup — verify a code against a secret
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { generateSecret, verify as verifyTOTP } from "otplib";
import QRCode from "qrcode";

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { getServerLocale, t } from "@/lib/i18n/translations";

const setupSchema = z.object({
  code: z.string().min(1),
  secret: z.string().min(1),
});

function buildOtpauthUrl(secret: string, username: string): string {
  const label = encodeURIComponent(`VControlHub:${username}`);
  const issuer = encodeURIComponent("VControlHub");
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

export async function POST(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: t("api.auth.twoFactor.setupFailed", locale),
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: t("api.auth.sessionExpired", locale) },
          { status: 401 },
        );

      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { twoFactorEnabled: true },
      });

      if (user?.twoFactorEnabled) {
        return NextResponse.json(
          { error: t("api.auth.twoFactor.alreadyEnabled", locale) },
          { status: 400 },
        );
      }

      const secret = generateSecret();
      const otpauthUrl = buildOtpauthUrl(secret, session.username || "user");
      // Generate QR offline so the TOTP secret never leaves the host as a third-party query string.
      const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 200,
      });

      return NextResponse.json({ secret, otpauthUrl, qrDataUrl });
    },
  );
}

export async function PUT(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: t("api.auth.twoFactor.verifyFailed", locale),
      bodySchema: setupSchema,
    },
    async ({ session, body }) => {
      if (!session)
        return NextResponse.json(
          { error: t("api.auth.sessionExpired", locale) },
          { status: 401 },
        );

      const { code, secret } = body;
      const valid = (await verifyTOTP({ token: code, secret })).valid;
      return NextResponse.json({ valid });
    },
  );
}

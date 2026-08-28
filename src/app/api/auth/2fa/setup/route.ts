/**
 * 2FA/TOTP Setup — generates a new TOTP secret, otpauth URL, and local QR data URL.
 * POST /api/auth/2fa/setup — generate secret + offline QR (no third-party image host)
 *
 * The response also carries an `enrollmentToken`: a short-lived signed ticket
 * binding this seed to this user. `POST /api/auth/2fa/enable` accepts only that
 * ticket, never a raw seed from the request body.
 *
 * There is deliberately no "verify a code against a secret" endpoint here. The
 * PUT that used to live at this path took both the code and the secret from the
 * caller and answered `{ valid }`, which proved nothing (whoever chose the seed
 * can compute a matching code) while handing out an unlimited-tries oracle for
 * checking codes against arbitrary seeds. `enable` verifies the code itself, so
 * the extra round trip bought nothing either.
 */
import { NextResponse } from "next/server";
import { generateSecret } from "otplib";
import QRCode from "qrcode";

import { createTwoFactorEnrollmentToken } from "@/lib/auth/two-factor-enrollment";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { getServerLocale, t } from "@/lib/i18n/translations";

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
      const enrollmentToken = createTwoFactorEnrollmentToken({
        userId: session.userId,
        secret,
      });

      return NextResponse.json({ secret, otpauthUrl, qrDataUrl, enrollmentToken });
    },
  );
}

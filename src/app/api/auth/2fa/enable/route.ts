/**
 * 2FA Enable — after verifying the TOTP code, saves the secret to DB.
 * POST /api/auth/2fa/enable  { code, enrollmentToken }
 *
 * The seed comes out of the signed enrollment ticket minted by
 * `/api/auth/2fa/setup`, not out of the request body. Accepting a raw seed here
 * meant a session could bind the account to an authenticator of its own
 * choosing, and the TOTP check was self-referential: whoever supplied the seed
 * could compute a code that matched it.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { verify as verifyTOTP } from "otplib";

import { openTwoFactorEnrollmentToken } from "@/lib/auth/two-factor-enrollment";
import { sealTwoFactorSecret } from "@/lib/auth/two-factor-secret";
import { createTwoFactorRecoveryCodes } from "@/lib/auth/two-factor-recovery";
import { bumpUserSessionEpoch } from "@/lib/auth/session";
import { refreshedSessionResponse } from "@/lib/auth/refreshed-session-response";
import { auditUserAction } from "@/lib/audit/service";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { getServerLocale, t } from "@/lib/i18n/translations";

import { ValidationError } from "@/lib/errors";
const enableSchema = z.object({
  code: z.string().min(1),
  enrollmentToken: z.string().min(1),
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
      const { code, enrollmentToken } = body;

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

      // Forged, expired, or issued-to-another-account tickets all land here.
      // Reported as an invalid code on purpose: the distinction is not useful to
      // a caller, and the recovery action is the same — restart setup.
      const secret = openTwoFactorEnrollmentToken(enrollmentToken, {
        userId: session.userId,
      });
      if (!secret) {
        throw new ValidationError(t("api.auth.twoFactor.enrollmentExpired", locale));
      }

      const valid = (await verifyTOTP({ token: code, secret })).valid;
      if (!valid) {
        throw new ValidationError(t("api.auth.twoFactor.invalidCode", locale));
      }

      const recovery = createTwoFactorRecoveryCodes();

      // Encrypt at rest — DB dumps / backups must not yield usable TOTP seeds.
      await prisma.user.update({
        where: { id: session.userId },
        data: {
          twoFactorEnabled: true,
          twoFactorSecret: sealTwoFactorSecret(secret),
          twoFactorRecoveryCodes: recovery.hashes,
        },
      });

      // Sessions minted before this upgrade never passed a second factor.
      // Advancing the epoch retires them all; a replacement cookie minted
      // against the new epoch keeps *this* browser logged in.
      await bumpUserSessionEpoch(session.userId);

      await auditUserAction(
        session.userId,
        "auth.2fa.enable",
        { userId: session.userId },
        "INFO",
        session.currentTeamId,
      );

      // Plaintext recovery codes are returned once, over the authenticated
      // response. Only HMAC fingerprints are persisted.
      return refreshedSessionResponse(session, request, {
        success: true,
        recoveryCodes: recovery.codes,
      });
    },
  );
}

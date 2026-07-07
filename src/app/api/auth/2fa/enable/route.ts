/**
 * 2FA Enable — after verifying the TOTP code, saves the secret to DB.
 * POST /api/auth/2fa/enable  { code, secret }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { verify as verifyTOTP } from "otplib";

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

import { ValidationError } from "@/lib/errors";
const enableSchema = z.object({
  code: z.string().min(1),
  secret: z.string().min(1),
});

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "Failed to enable two-factor authentication",
      bodySchema: enableSchema,
    },
    async ({ session, body }) => {
      if (!session)
        return NextResponse.json(
          { error: "Not authenticated or session expired" },
          { status: 401 },
        );

      const { code, secret } = body;

      const valid = verifyTOTP({ token: code, secret });
      if (!valid) {
        throw new ValidationError("Invalid verification code");
      }

      await prisma.user.update({
        where: { id: session.userId },
        data: { twoFactorEnabled: true, twoFactorSecret: secret },
      });

      return NextResponse.json({ success: true });
    },
  );
}

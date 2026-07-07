/**
 * 2FA Disable — verify current TOTP code, then disable 2FA.
 * POST /api/auth/2fa/disable  { code }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { verify as verifyTOTP } from "otplib";

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

import { ValidationError } from "@/lib/errors";
const disableSchema = z.object({ code: z.string().min(1) });

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "Failed to disable two-factor verification",
      bodySchema: disableSchema,
    },
    async ({ session, body }) => {
      if (!session)
        return NextResponse.json(
          { error: "Not authenticated or session expired" },
          { status: 401 },
        );

      const { code } = body;

      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { twoFactorEnabled: true, twoFactorSecret: true },
      });

      if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
        throw new ValidationError("Two-factor verification is not enabled");
      }

      const valid = verifyTOTP({ token: code, secret: user.twoFactorSecret });
      if (!valid) {
        throw new ValidationError("Invalid verification code");
      }

      await prisma.user.update({
        where: { id: session.userId },
        data: { twoFactorEnabled: false, twoFactorSecret: null },
      });

      return NextResponse.json({ success: true });
    },
  );
}

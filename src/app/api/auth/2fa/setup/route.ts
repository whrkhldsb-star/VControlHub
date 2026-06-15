/**
 * 2FA/TOTP Setup — generates a new TOTP secret and otpauth URL.
 * POST /api/auth/2fa/setup — generate secret
 * PUT  /api/auth/2fa/setup — verify a code against a secret
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { generateSecret, verify as verifyTOTP } from "otplib";

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

import { ValidationError } from "@/lib/errors";
const setupSchema = z.object({
  code: z.string().min(1),
  secret: z.string().min(1),
});

function buildOtpauthUrl(secret: string, username: string): string {
  const label = encodeURIComponent(`VPS管控平台:${username}`);
  const issuer = encodeURIComponent("VPS管控平台");
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "设置两步验证失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: "未登录或会话已过期" },
          { status: 401 },
        );

      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { twoFactorEnabled: true },
      });

      if (user?.twoFactorEnabled) {
        return NextResponse.json(
          { error: "两步验证已启用，请先禁用再重新设置" },
          { status: 400 },
        );
      }

      const secret = generateSecret();
      const otpauthUrl = buildOtpauthUrl(secret, session.username || "user");

      return NextResponse.json({ secret, otpauthUrl });
    },
  );
}

export async function PUT(request: Request) {
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "验证失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: "未登录或会话已过期" },
          { status: 401 },
        );

      const parsed = setupSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success)
        throw new ValidationError("输入参数无效");
      const { code, secret } = parsed.data;
      const valid = verifyTOTP({ token: code, secret });
      return NextResponse.json({ valid });
    },
  );
}

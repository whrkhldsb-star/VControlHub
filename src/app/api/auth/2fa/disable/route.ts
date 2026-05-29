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

const disableSchema = z.object({ code: z.string().min(1) });

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "禁用两步验证失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json(
          { error: "未登录或会话已过期" },
          { status: 401 },
        );

      const parsed = disableSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success)
        return NextResponse.json({ error: "输入参数无效" }, { status: 400 });
      const { code } = parsed.data;

      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { twoFactorEnabled: true, twoFactorSecret: true },
      });

      if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
        return NextResponse.json({ error: "两步验证未启用" }, { status: 400 });
      }

      const valid = verifyTOTP({ token: code, secret: user.twoFactorSecret });
      if (!valid) {
        return NextResponse.json({ error: "验证码错误" }, { status: 400 });
      }

      await prisma.user.update({
        where: { id: session.userId },
        data: { twoFactorEnabled: false, twoFactorSecret: null },
      });

      return NextResponse.json({ success: true });
    },
  );
}

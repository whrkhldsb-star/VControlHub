/**
 * 2FA Enable — after verifying the TOTP code, saves the secret to DB.
 * POST /api/auth/2fa/enable  { code, secret }
 */
import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth/api-session";
import { prisma } from "@/lib/db";
import { verify as verifyTOTP } from "otplib";

export async function POST(request: Request) {
	try {
		const session = await getApiSession();
		if (!session) {
			return NextResponse.json({ error: "未登录或会话已过期" }, { status: 401 });
		}

		const { code, secret } = (await request.json()) as { code: string; secret: string };
		if (!code || !secret) {
			return NextResponse.json({ error: "缺少验证码或密钥" }, { status: 400 });
		}

		const valid = verifyTOTP({ token: code, secret });
		if (!valid) {
			return NextResponse.json({ error: "验证码错误" }, { status: 400 });
		}

		await prisma.user.update({
			where: { id: session.userId },
			data: { twoFactorEnabled: true, twoFactorSecret: secret },
		});

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error("[2fa/enable]", error);
		return NextResponse.json({ error: "启用两步验证失败" }, { status: 500 });
	}
}

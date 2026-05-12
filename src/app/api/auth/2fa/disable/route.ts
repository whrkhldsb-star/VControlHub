/**
 * 2FA Disable — verify current TOTP code, then disable 2FA.
 * POST /api/auth/2fa/disable  { code }
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

		const { code } = (await request.json()) as { code: string };
		if (!code) {
			return NextResponse.json({ error: "缺少验证码" }, { status: 400 });
		}

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
	} catch (error) {
		console.error("[2fa/disable]", error);
		return NextResponse.json({ error: "禁用两步验证失败" }, { status: 500 });
	}
}

/**
 * 2FA Login Verification — exchange a pending-2fa token + TOTP code for a full session.
 * POST /api/auth/2fa/verify-login { code }
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { verify as verifyTOTP } from "otplib";
import { prisma } from "@/lib/db";
import { verifyPending2faToken, createSessionToken, getSessionCookieName, getPending2faCookieName } from "@/lib/auth/session";
import { generateCsrfToken, getCsrfCookieName } from "@/lib/auth/csrf";
import { auditUserAction, auditSystemAction } from "@/lib/audit/service";
import { checkRateLimit, getClientIp, LOGIN_RATE_LIMIT } from "@/lib/rate-limit";

export async function POST(request: Request) {
	try {
		// Rate limit 2FA attempts
		const clientIp = getClientIp(request);
		const rateCheck = checkRateLimit(clientIp, LOGIN_RATE_LIMIT);
		if (!rateCheck.allowed) {
			return NextResponse.json({ error: "验证尝试过于频繁，请稍后再试" }, { status: 429 });
		}

		const { code } = (await request.json()) as { code: string };
		if (!code || !/^\d{4,8}$/.test(code)) {
			return NextResponse.json({ error: "请输入有效的验证码" }, { status: 400 });
		}

		// Read the pending 2FA cookie
		const cookieStore = await cookies();
		const pendingCookie = cookieStore.get(getPending2faCookieName());
		if (!pendingCookie?.value) {
			return NextResponse.json({ error: "会话已过期，请重新登录" }, { status: 401 });
		}

		const sessionPayload = await verifyPending2faToken(pendingCookie.value);
		if (!sessionPayload) {
			// Clear the invalid pending cookie
			cookieStore.delete(getPending2faCookieName());
			return NextResponse.json({ error: "会话已过期，请重新登录" }, { status: 401 });
		}

		// Look up the user's TOTP secret
		const user = await prisma.user.findUnique({
			where: { id: sessionPayload.userId },
			select: { twoFactorSecret: true, twoFactorEnabled: true },
		});

		if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
			cookieStore.delete(getPending2faCookieName());
			return NextResponse.json({ error: "两步验证未启用" }, { status: 400 });
		}

		// Verify the TOTP code
		const valid = verifyTOTP({ token: code, secret: user.twoFactorSecret });
		if (!valid) {
			auditSystemAction("auth.2fa_failed", { userId: sessionPayload.userId, ip: clientIp }, "WARNING");
			return NextResponse.json({ error: "验证码错误" }, { status: 400 });
		}

		// ── 2FA verified — create full session ──
		const token = await createSessionToken(sessionPayload);
		const csrfToken = generateCsrfToken();

		// Clear the pending 2FA cookie
		cookieStore.delete(getPending2faCookieName());

		auditUserAction(sessionPayload.userId, "auth.login_2fa_ok", { username: sessionPayload.username, ip: clientIp });

		return NextResponse.json({ success: true }, {
			status: 200,
			headers: {
				"Set-Cookie": [
					`${getSessionCookieName()}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`,
					`${getCsrfCookieName()}=${csrfToken}; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`,
				].join(", "),
			},
		});
	} catch (error) {
		console.error("[2fa/verify-login]", error);
		return NextResponse.json({ error: "验证失败，请重试" }, { status: 500 });
	}
}

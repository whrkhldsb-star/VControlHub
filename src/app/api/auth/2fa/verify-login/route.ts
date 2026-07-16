/**
 * 2FA Login Verification — exchange a pending-2fa token + TOTP code for a full session.
 * POST /api/auth/2fa/verify-login { code }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";

import { verify as verifyTOTP } from "otplib";
import { prisma } from "@/lib/db";
import { verifyPending2faToken, createSessionToken, getSessionCookieName, getPending2faCookieName, getConfiguredSessionTtlSeconds } from "@/lib/auth/session";
import { generateCsrfToken, getCsrfCookieName } from "@/lib/auth/csrf";
import { auditUserAction, auditSystemAction } from "@/lib/audit/service";
import { checkRateLimitAsync, getClientIp, LOGIN_RATE_LIMIT } from "@/lib/rate-limit";
import { apiCatch, apiError } from "@/lib/http/api-error";
import { isRequestHttps } from "@/lib/http/request-https";

const verifyLoginSchema = z.object({ code: z.string().min(1) });
// guardMode: login

export async function POST(request: Request) {
	try {
		// Rate limit 2FA attempts
		const clientIp = getClientIp(request);
		const rateCheck = await checkRateLimitAsync(clientIp, LOGIN_RATE_LIMIT);
		if (!rateCheck.allowed) {
			return apiError({
				code: "RATE_LIMITED",
				message: "Too many verification attempts, please try again later",
				status: 429,
			});
		}

		const parsed = verifyLoginSchema.safeParse(await request.json());
		if (!parsed.success) {
			return apiError({
				code: "VALIDATION_FAILED",
				message: "Invalid input parameter",
				status: 400,
				details: parsed.error.flatten().fieldErrors,
			});
		}
		const { code } = parsed.data;
		if (!/^\d{4,8}$/.test(code)) {
			return apiError({
				code: "VALIDATION_FAILED",
				message: "Please enter a valid verification code",
				status: 400,
				details: { fieldErrors: { code: ["format must be 4-8 digits"] } },
			});
		}

		// Read the pending 2FA cookie
		const cookieStore = await cookies();
		const pendingCookie = cookieStore.get(getPending2faCookieName());
		if (!pendingCookie?.value) {
			return apiError({
				code: "PENDING_2FA_EXPIRED",
				message: "Session expired, please log in again",
				status: 401,
			});
		}

		const sessionPayload = await verifyPending2faToken(pendingCookie.value);
		if (!sessionPayload) {
			// Clear the invalid pending cookie
			cookieStore.delete(getPending2faCookieName());
			return apiError({
				code: "PENDING_2FA_EXPIRED",
				message: "Session expired, please log in again",
				status: 401,
			});
		}

		// Look up the user's TOTP secret
		const user = await prisma.user.findUnique({
			where: { id: sessionPayload.userId },
			select: { twoFactorSecret: true, twoFactorEnabled: true },
		});

		if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
			cookieStore.delete(getPending2faCookieName());
			return apiError({
				code: "TWO_FACTOR_DISABLED",
				message: "Two-factor verification is not enabled",
				status: 400,
			});
		}

		// Verify the TOTP code
		const valid = verifyTOTP({ token: code, secret: user.twoFactorSecret });
		if (!valid) {
			await auditSystemAction("auth.2fa_failed", { userId: sessionPayload.userId, ip: clientIp }, "WARNING");
			return apiError({
				code: "TWO_FACTOR_INVALID_CODE",
				message: "VerifycodeError",
				status: 400,
			});
		}

		// ── 2FA verified — create full session ──
		const { remember, ...fullSessionPayload } = sessionPayload;
		const rememberSession = remember === true;
		const sessionMaxAge = await getConfiguredSessionTtlSeconds(rememberSession);
		const token = await createSessionToken(fullSessionPayload, { remember: rememberSession });
		const csrfToken = generateCsrfToken();
		const cookieSecure = isRequestHttps(request);

		// Clear the pending 2FA cookie
		cookieStore.delete(getPending2faCookieName());

		await auditUserAction(sessionPayload.userId, "auth.login_2fa_ok", { username: sessionPayload.username, ip: clientIp });

		const response = NextResponse.json({ success: true });
		response.cookies.set(getSessionCookieName(), token, {
			httpOnly: true,
			sameSite: "lax",
			path: "/",
			maxAge: sessionMaxAge,
			secure: cookieSecure,
		});
		response.cookies.set(getCsrfCookieName(), csrfToken, {
			sameSite: "lax",
			path: "/",
			maxAge: sessionMaxAge,
			secure: cookieSecure,
		});
		response.cookies.set(getPending2faCookieName(), "", {
			httpOnly: true,
			sameSite: "lax",
			path: "/",
			maxAge: 0,
			secure: cookieSecure,
		});
		return response;
	} catch (error) {
		// apiCatch with 500 fallback logs the error and returns INTERNAL_ERROR
		return apiCatch(error, 500, "Verification failed, please retry");
	}
}

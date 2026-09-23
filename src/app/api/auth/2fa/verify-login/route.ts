import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * 2FA Login Verification — exchange a pending-2fa token + TOTP code for a full session.
 * POST /api/auth/2fa/verify-login { code }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { verifyPending2faToken, createSessionToken, getSessionCookieName, getPending2faCookieName, getConfiguredSessionTtlSeconds } from "@/lib/auth/session";
import { generateCsrfToken, getCsrfCookieName } from "@/lib/auth/csrf";
import { isAcceptableTwoFactorCodeShape, verifyTwoFactorChallenge } from "@/lib/auth/two-factor-challenge";
import { DEFAULT_ROLE_PERMISSIONS, type RoleKey } from "@/lib/auth/rbac";
import { auditUserAction, auditSystemAction } from "@/lib/audit/service";
import { checkRateLimitAsync, getClientIp, LOGIN_RATE_LIMIT, isAccountLockedAsync, recordLoginFailureAsync, clearLoginFailureAsync } from "@/lib/rate-limit";
import { apiCatch, apiError } from "@/lib/http/api-error";
import { isRequestHttps } from "@/lib/http/request-https";
import { isCrossSiteFormPost } from "@/lib/http/request-origin";
import { readRequestBodyBuffer } from "@/lib/http/request-body";

const verifyLoginSchema = z.object({ code: z.string().min(1) });
// guardMode: login

const MAX_VERIFY_LOGIN_BODY_BYTES = 4 * 1024;

export async function POST(request: Request) {
	try {
		// Defence in depth for the login-CSRF window this route shares with
		// /api/login (both skip the double-submit CSRF check pre-session).
		if (isCrossSiteFormPost(request)) {
			return apiError({
				code: "GENERIC_ERROR",
				message: apiCopy("apiCopy.invalid.input.parameter.d64ebcd8"),
				status: 400,
			});
		}

		// Rate limit 2FA attempts
		const clientIp = getClientIp(request);
		const rateCheck = await checkRateLimitAsync(clientIp, LOGIN_RATE_LIMIT);
		if (!rateCheck.allowed) {
			return apiError({
				code: "RATE_LIMITED",
				message: apiCopy("apiCopy.too.many.verification.attempts.please.try.again.later.a8754aa7"),
				status: 429,
			});
		}

		// request.json() buffers without any byte cap; read bounded instead so a
		// chunked body cannot turn this pre-session endpoint into a memory sink.
		let rawBody: unknown;
		try {
			rawBody = JSON.parse((await readRequestBodyBuffer(request, MAX_VERIFY_LOGIN_BODY_BYTES)).toString("utf8"));
		} catch {
			return apiError({
				code: "VALIDATION_FAILED",
				message: apiCopy("apiCopy.invalid.input.parameter.d64ebcd8"),
				status: 400,
			});
		}
		const parsed = verifyLoginSchema.safeParse(rawBody);
		if (!parsed.success) {
			return apiError({
				code: "VALIDATION_FAILED",
				message: apiCopy("apiCopy.invalid.input.parameter.d64ebcd8"),
				status: 400,
				details: parsed.error.flatten().fieldErrors,
			});
		}
		const { code } = parsed.data;
		if (!isAcceptableTwoFactorCodeShape(code)) {
			return apiError({
				code: "VALIDATION_FAILED",
				message: apiCopy("apiCopy.please.enter.a.valid.verification.or.recovery.code.a10445f6"),
				status: 400,
				details: { fieldErrors: { code: ["format must be a 6-digit authenticator code or recovery code"] } },
			});
		}

		// Read the pending 2FA cookie
		const cookieStore = await cookies();
		const pendingCookie = cookieStore.get(getPending2faCookieName());
		if (!pendingCookie?.value) {
			return apiError({
				code: "PENDING_2FA_EXPIRED",
				message: apiCopy("apiCopy.session.expired.please.log.in.again.dd2b79a4"),
				status: 401,
			});
		}

		const sessionPayload = await verifyPending2faToken(pendingCookie.value);
		if (!sessionPayload) {
			// Clear the invalid pending cookie
			cookieStore.delete(getPending2faCookieName());
			return apiError({
				code: "PENDING_2FA_EXPIRED",
				message: apiCopy("apiCopy.session.expired.please.log.in.again.dd2b79a4"),
				status: 401,
			});
		}

		// Look up the user's TOTP secret + live role/status snapshot.
		// Pending-2FA tokens embed roles from password-login time; re-load from DB
		// so revocation/disable mid-pending window cannot mint a stale full session.
		const user = await prisma.user.findUnique({
			where: { id: sessionPayload.userId },
			select: {
				twoFactorSecret: true,
				twoFactorEnabled: true,
				twoFactorRecoveryCodes: true,
				status: true,
				username: true,
				mustChangePassword: true,
				currentTeamId: true,
				roles: { select: { role: { select: { key: true } } } },
			},
		});

		if (!user || user.status === "DISABLED") {
			cookieStore.delete(getPending2faCookieName());
			return apiError({
				code: "PENDING_2FA_EXPIRED",
				message: apiCopy("apiCopy.session.expired.please.log.in.again.dd2b79a4"),
				status: 401,
			});
		}

		if (!user.twoFactorEnabled || !user.twoFactorSecret) {
			cookieStore.delete(getPending2faCookieName());
			return apiError({
				code: "TWO_FACTOR_DISABLED",
				message: apiCopy("apiCopy.two.factor.verification.is.not.enabled.268de26d"),
				status: 400,
			});
		}

		// The password stage of this login was already paid for — the pending
		// cookie proves it — so hold the account-lockout gate here as well:
		// an attacker holding the password (and a stolen pending cookie) must
		// not get unlimited TOTP guesses just by rotating IPs past the per-IP
		// limiter above.
		const twoFactorLock = await isAccountLockedAsync(user.username);
		if (twoFactorLock.locked) {
			cookieStore.delete(getPending2faCookieName());
			return apiError({
				code: "ACCOUNT_LOCKED",
				message: apiCopy("apiCopy.too.many.verification.attempts.please.try.again.later.a8754aa7"),
				status: 429,
			});
		}

		// An authenticator code first (sealed seed; legacy plaintext still
		// accepted), then a one-use recovery code, consumed atomically. Shared with
		// the 2FA disable / regenerate routes so the two factors stay interchangeable.
		const { valid, usedRecoveryCode } = await verifyTwoFactorChallenge({
			userId: sessionPayload.userId,
			code,
			sealedSecret: user.twoFactorSecret,
			storedRecoveryCodes: user.twoFactorRecoveryCodes,
		});
		if (!valid) {
			await auditSystemAction("auth.2fa_failed", { userId: sessionPayload.userId, ip: clientIp }, "WARNING", user.currentTeamId);
			// Count 2FA misses against the account lockout (same counter the
			// password stage uses). Without this, a leaked password plus IP
			// rotation reduces 2FA to an offline guess of a 6-digit space.
			const lockResult = await recordLoginFailureAsync(user.username);
			if (lockResult.locked) {
				cookieStore.delete(getPending2faCookieName());
				await auditSystemAction("auth.account_locked", { username: user.username, ip: clientIp, stage: "2fa", failCount: lockResult.failCount }, "WARNING");
				return apiError({
					code: "ACCOUNT_LOCKED",
					message: apiCopy("apiCopy.too.many.verification.attempts.please.try.again.later.a8754aa7"),
					status: 429,
				});
			}
			return apiError({
				code: "TWO_FACTOR_INVALID_CODE",
				message: apiCopy("apiCopy.verifycodeerror.11ef6ba1"),
				status: 400,
			});
		}
		// Full success — the login (password + second factor) is complete.
		await clearLoginFailureAsync(user.username);

		// ── 2FA verified — create full session from live DB state ──
		const liveRoles = user.roles
			.map((entry) => entry.role.key)
			.filter((key): key is RoleKey => key in DEFAULT_ROLE_PERMISSIONS);

		const rememberSession = sessionPayload.remember === true;
		const sessionMaxAge = await getConfiguredSessionTtlSeconds(rememberSession);
		const token = await createSessionToken(
			{
				userId: sessionPayload.userId,
				username: user.username,
				roles: liveRoles,
				mustChangePassword: user.mustChangePassword,
				currentTeamId: user.currentTeamId,
			},
			{ remember: rememberSession },
		);
		const csrfToken = generateCsrfToken();
		const cookieSecure = isRequestHttps(request);

		// Clear the pending 2FA cookie
		cookieStore.delete(getPending2faCookieName());

		await auditUserAction(
			sessionPayload.userId,
			usedRecoveryCode ? "auth.login_2fa_recovery_ok" : "auth.login_2fa_ok",
			{ username: user.username, ip: clientIp },
			undefined,
			user?.currentTeamId,
		);

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

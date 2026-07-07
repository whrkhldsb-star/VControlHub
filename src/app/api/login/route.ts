import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateUser } from "@/lib/auth/service";
import { createSessionToken, getSessionCookieName, createPending2faToken, getPending2faCookieName, getConfiguredSessionTtlSeconds } from "@/lib/auth/session";
import { auditUserAction, auditSystemAction } from "@/lib/audit/service";
import { createLogger } from "@/lib/logging";
import { checkRateLimitAsync, getClientIp, LOGIN_RATE_LIMIT, LOGIN_SLOW_RATE_LIMIT, isAccountLocked, recordLoginFailure, clearLoginFailure } from "@/lib/rate-limit";
import { generateCsrfToken, getCsrfCookieName } from "@/lib/auth/csrf";

const logger = createLogger("api:login");
// guardMode: login

const loginFormSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  next: z.string().optional(),
  remember: z.string().optional(),
});

function safeNextPath(nextValue: FormDataEntryValue | null) {
	const next = typeof nextValue === "string" ? nextValue : "/";
	return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function redirectWithRelativeLocation(path: string, status: 303 = 303) {
	const response = NextResponse.redirect("http://127.0.0.1" + path, status);
	response.headers.set("location", path);
	return response;
}

export async function POST(request: Request) {
	try {
		// Rate limiting — check both fast and slow windows
		const clientIp = getClientIp(request);
		const fastCheck = await checkRateLimitAsync(clientIp, LOGIN_RATE_LIMIT);
		const slowCheck = await checkRateLimitAsync(clientIp, LOGIN_SLOW_RATE_LIMIT);

		if (!fastCheck.allowed || !slowCheck.allowed) {
			const retryAfter = !fastCheck.allowed
				? Math.ceil(fastCheck.retryAfterMs / 1000)
				: Math.ceil(slowCheck.retryAfterMs / 1000);
			const params = new URLSearchParams({ error: "rate_limited" });
			auditSystemAction("auth.login_rate_limited", { ip: clientIp, retryAfter }, "WARNING");
			const response = redirectWithRelativeLocation(`/login?${params.toString()}`);
			response.headers.set("Retry-After", String(retryAfter));
			return response;
		}

		// Guard: only parse form data for valid content types
		const contentType = request.headers.get("content-type") ?? "";
		if (!contentType.includes("multipart/form-data") && !contentType.includes("application/x-www-form-urlencoded")) {
			return redirectWithRelativeLocation("/login?error=invalid");
		}

		const formData = await request.formData();
		const formRaw = {
			username: String(formData.get("username") ?? ""),
			password: String(formData.get("password") ?? ""),
			next: formData.get("next") instanceof File ? undefined : (formData.get("next") as string | null) ?? undefined,
			remember: formData.get("remember") instanceof File ? undefined : (formData.get("remember") as string | null) ?? undefined,
		};
		const parsed = loginFormSchema.safeParse(formRaw);
		if (!parsed.success) {
			const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0] ?? "Validation failed";
			const params = new URLSearchParams({ error: "invalid", detail: firstError });
			return redirectWithRelativeLocation(`/login?${params.toString()}`);
		}
		const { username, password } = parsed.data;
		const rememberSession = parsed.data.remember === "on" || parsed.data.remember === "true" || parsed.data.remember === "1";
		const sessionMaxAge = await getConfiguredSessionTtlSeconds(rememberSession);
		const requestedNextPath = safeNextPath(formData.get("next"));

		// Check account lockout before attempting authentication
		const lockCheck = isAccountLocked(username);
		if (lockCheck.locked) {
			const remainingMin = Math.ceil((lockCheck.lockedUntil! - Date.now()) / 60000);
			const params = new URLSearchParams({ error: "locked", minutes: String(remainingMin) });
			return redirectWithRelativeLocation(`/login?${params.toString()}`);
		}

		const user = await authenticateUser({ username, password });
		if (!user) {
			// Account lockout: record failure and check
			const lockResult = recordLoginFailure(username);
			if (lockResult.locked) {
				const remainingMin = Math.ceil((lockResult.lockedUntil! - Date.now()) / 60000);
				auditSystemAction("auth.account_locked", { username, ip: clientIp, failCount: lockResult.failCount }, "WARNING");
				const params = new URLSearchParams({ error: "locked", minutes: String(remainingMin) });
				return redirectWithRelativeLocation(`/login?${params.toString()}`);
			}
			auditSystemAction("auth.login_failed", { username, ip: clientIp, failCount: lockResult.failCount }, "WARNING");
			const invalidPath = new URLSearchParams(
				requestedNextPath === "/"
					? { error: "invalid" }
					: { error: "invalid", next: requestedNextPath },
			);
			return redirectWithRelativeLocation(`/login?${invalidPath.toString()}`);
		}

		const nextPath = requestedNextPath === "/" ? user.preferences.defaultPage : requestedNextPath;

		// Log successful login & clear any previous failure count
		clearLoginFailure(username);
		auditUserAction(user.id, "auth.login_password_ok", { username, ip: clientIp });

		// ── 2FA Check ──
		// If the user has 2FA enabled, redirect to the verification page
		// instead of creating a full session right away.
		if (user.twoFactorEnabled && user.twoFactorSecret) {
			const pendingToken = await createPending2faToken({
				userId: user.id,
				username: user.username,
				roles: user.roles,
				mustChangePassword: user.mustChangePassword,
				currentTeamId: user.currentTeamId,
			});
			const requestUrl = new URL(request.url);
			const params = new URLSearchParams({ next: nextPath });
			const response = redirectWithRelativeLocation(`/login/verify-2fa?${params.toString()}`);
			response.cookies.set(getPending2faCookieName(), pendingToken, {
				httpOnly: true,
				sameSite: "lax",
				secure: requestUrl.protocol === "https:",
				path: "/",
				maxAge: 5 * 60, // 5-minute expiry for 2FA pending token
			});
			return response;
		}

		// ── No 2FA — create full session ──

		const token = await createSessionToken({
			userId: user.id,
			username: user.username,
			roles: user.roles,
			mustChangePassword: user.mustChangePassword,
			currentTeamId: user.currentTeamId,
		}, { remember: rememberSession });

		const requestUrl = new URL(request.url);
		const response = redirectWithRelativeLocation(nextPath);
		response.cookies.set(getSessionCookieName(), token, {
			httpOnly: true,
			sameSite: "lax",
			secure: requestUrl.protocol === "https:",
			path: "/",
			maxAge: sessionMaxAge,
		});
		// Set CSRF token cookie (non-HttpOnly so JS can read it for headers)
		const csrfToken = generateCsrfToken();
		response.cookies.set(getCsrfCookieName(), csrfToken, {
			httpOnly: false,
			sameSite: "lax",
			secure: requestUrl.protocol === "https:",
			path: "/",
			maxAge: sessionMaxAge,
		});
		return response;
	} catch (e) {
		logger.error("login failed with system error", e);
		return redirectWithRelativeLocation("/login?error=system");
	}
}

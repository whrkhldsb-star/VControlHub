import { NextResponse } from "next/server";

import { authenticateUser } from "@/lib/auth/service";
import { createSessionToken, getSessionCookieName } from "@/lib/auth/session";
import { auditUserAction, auditSystemAction } from "@/lib/audit/service";
import { checkRateLimit, getClientIp, LOGIN_RATE_LIMIT, LOGIN_SLOW_RATE_LIMIT } from "@/lib/rate-limit";

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
		const fastCheck = checkRateLimit(clientIp, LOGIN_RATE_LIMIT);
		const slowCheck = checkRateLimit(clientIp, LOGIN_SLOW_RATE_LIMIT);

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
		const username = String(formData.get("username") ?? "");
		const password = String(formData.get("password") ?? "");
		const nextPath = safeNextPath(formData.get("next"));

		const user = await authenticateUser({ username, password });
		if (!user) {
			auditSystemAction("auth.login_failed", { username, ip: clientIp }, "WARNING");
			const invalidPath = new URLSearchParams(
				nextPath === "/"
					? { error: "invalid" }
					: { error: "invalid", next: nextPath },
			);
			return redirectWithRelativeLocation(`/login?${invalidPath.toString()}`);
		}

		// Log successful login
		auditUserAction(user.id, "auth.login", { username, ip: clientIp });

		const token = await createSessionToken({
			userId: user.id,
			username: user.username,
			roles: user.roles,
			mustChangePassword: user.mustChangePassword,
		});

		const requestUrl = new URL(request.url);
		const response = redirectWithRelativeLocation(nextPath);
		response.cookies.set(getSessionCookieName(), token, {
			httpOnly: true,
			sameSite: "lax",
			secure: requestUrl.protocol === "https:",
			path: "/",
			maxAge: 7 * 24 * 60 * 60,
		});
		return response;
	} catch (e) {
		console.error("LOGIN ERROR:", e);
		return redirectWithRelativeLocation("/login?error=system");
	}
}

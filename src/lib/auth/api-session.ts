/**
 * Session verification for API routes.
 * Unlike `requireSession()` (which redirects to /login), this returns
 * a proper 401 JSON response when the session is missing or invalid.
 *
 * Also enforces `mustChangePassword`: page routes redirect to
 * `/account/password`, but API consumers must receive a JSON 403 so
 * they cannot call privileged endpoints with a bootstrap/default password.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSessionCookieName, verifySessionToken, type SessionPayload } from "@/lib/auth/session";

/**
 * Verify session for API routes. Returns SessionPayload or null.
 * Does NOT redirect — returns null if session is missing/invalid.
 * Does NOT reject mustChangePassword (callers that need that gate use
 * {@link requireApiSession}).
 */
export async function getApiSession(): Promise<SessionPayload | null> {
	try {
		const cookieStore = await cookies();
		const sessionCookie = cookieStore.get(getSessionCookieName());

		if (!sessionCookie?.value) return null;

		try {
			return await verifySessionToken(sessionCookie.value);
		} catch {
			cookieStore.delete(getSessionCookieName());
			return null;
		}
	} catch {
		return null;
	}
}

/**
 * Require session for API routes. Returns SessionPayload or a NextResponse.
 * Use this in API route handlers instead of `requireSession()`.
 *
 * - 401 when missing/invalid session
 * - 403 MUST_CHANGE_PASSWORD when the user must reset password first
 */
export async function requireApiSession(): Promise<SessionPayload | NextResponse> {
	const session = await getApiSession();
	if (!session) {
		return NextResponse.json({ error: "Not authenticated or session expired" }, { status: 401 });
	}
	if (session.mustChangePassword) {
		return NextResponse.json(
			{
				error: "Password change required",
				code: "MUST_CHANGE_PASSWORD",
				redirectTo: "/account/password",
			},
			{ status: 403 },
		);
	}
	return session;
}

/**
 * Type guard: check if the result is a session (not a 401/403 response).
 */
export function isSessionPayload(result: SessionPayload | NextResponse): result is SessionPayload {
	return !(result instanceof NextResponse);
}

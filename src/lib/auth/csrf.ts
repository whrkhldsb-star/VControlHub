/**
 * CSRF protection using the Double Submit Cookie pattern.
 *
 * Strategy:
 * - On POST/PUT/DELETE/PATCH requests, the client must send a csrf_token
 *   cookie AND an X-CSRF-Token header (or csrf_token in form body).
 * - Both values must match for the request to proceed.
 * - GET/HEAD/OPTIONS requests are safe by definition and skip the check.
 * - The token is a random hex string, rotated on each login.
 */

import { randomBytes } from "node:crypto";

const CSRF_TOKEN_LENGTH = 32;
const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "x-csrf-token";
/** Generate a new CSRF token */
export function generateCsrfToken(): string {
	return randomBytes(CSRF_TOKEN_LENGTH).toString("hex");
}

/** Get the CSRF cookie name */
export function getCsrfCookieName(): string {
	return CSRF_COOKIE_NAME;
}

/** Validate CSRF token from request against cookie value */
export function validateCsrf(request: Request): boolean {
	// Only check state-changing methods
	const method = request.method.toUpperCase();
	if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;

	const cookieHeader = request.headers.get("cookie") ?? "";
	const cookieToken = extractCookie(cookieHeader, CSRF_COOKIE_NAME);
	if (!cookieToken) return false;

	// Check header first, then form body
	const headerToken = request.headers.get(CSRF_HEADER_NAME);
	if (headerToken) return headerToken === cookieToken;

	// For form submissions, the token may be in the form body
	// Note: we can't read the body here without consuming it,
	// so the caller should pass it through FormData
	return false;
}

/** Extract a cookie value from a cookie header string */
function extractCookie(cookieHeader: string, name: string): string | null {
	const prefix = `${name}=`;
	const cookie = cookieHeader
		.split(";")
		.map((c) => c.trim())
		.find((c) => c.startsWith(prefix));
	if (!cookie) return null;
	return decodeURIComponent(cookie.slice(prefix.length));
}

/**
 * Set CSRF cookie on a response.
 * Call this when issuing a new session (login) to rotate the CSRF token.
 */
export function setCsrfCookie(response: Response, token: string): void {
	response.headers.append(
		"Set-Cookie",
		[
			`${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
			"Path=/",
			"SameSite=Strict",
			process.env.NODE_ENV === "production" ? "Secure" : "",
		]
			.filter(Boolean)
			.join("; "),
	);
}

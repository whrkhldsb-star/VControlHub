/**
 * CSRF token helpers (Double Submit Cookie pattern).
 *
 * Enforcement lives in `src/proxy.ts` (cookie `csrf_token` vs `x-csrf-token` header). The few routes left out of the
 * proxy's matcher make the same comparison themselves through `./csrf-request`.
 * Login / 2FA verify-login issue the cookie via `response.cookies.set(getCsrfCookieName(), ...)`.
 */

import { randomBytes } from "node:crypto";

const CSRF_TOKEN_LENGTH = 32;
const CSRF_COOKIE_NAME = "csrf_token";

/** Generate a new CSRF token */
export function generateCsrfToken(): string {
	return randomBytes(CSRF_TOKEN_LENGTH).toString("hex");
}

/** Get the CSRF cookie name */
export function getCsrfCookieName(): string {
	return CSRF_COOKIE_NAME;
}

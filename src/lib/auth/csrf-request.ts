/**
 * The double-submit CSRF comparison, in one place.
 *
 * `src/proxy.ts` makes it for every state-changing API request it runs on. A
 * few upload routes are left out of the proxy (see `config.matcher` there:
 * Next would buffer and cut their bodies), so they make the same comparison
 * themselves with {@link requestPassesCsrfCheck}.
 */
import { timingSafeEqualString } from "@/lib/security/timing-safe-equal";

/** Same name as `getCsrfCookieName()` in ./csrf; repeated so the proxy does not load node:crypto for it. */
export const CSRF_COOKIE_NAME = "csrf_token";
export const CSRF_HEADER_NAME = "x-csrf-token";
export const CSRF_FAILURE_MESSAGE = "CSRF token validation failed";

/** True when the JS-readable cookie and the header the page copied it into are both present and equal. */
export function csrfTokensMatch(cookieToken: string | null | undefined, headerToken: string | null | undefined): boolean {
	return Boolean(cookieToken && headerToken && timingSafeEqualString(cookieToken, headerToken));
}

function readCookie(request: Request, name: string): string | null {
	const prefix = `${name}=`;
	let found: string | null = null;
	for (const part of (request.headers.get("cookie") ?? "").split(";")) {
		const trimmed = part.trim();
		if (!trimmed.startsWith(prefix)) continue;
		const raw = trimmed.slice(prefix.length);
		try {
			found = decodeURIComponent(raw);
		} catch {
			found = raw;
		}
	}
	return found;
}

/**
 * The proxy's CSRF check for a route the proxy does not run on. Call it for a
 * state-changing request authenticated by the session cookie; a request that
 * carries no cookie at all (an API token) has no ambient authority to abuse.
 */
export function requestPassesCsrfCheck(request: Request): boolean {
	return csrfTokensMatch(readCookie(request, CSRF_COOKIE_NAME), request.headers.get(CSRF_HEADER_NAME));
}

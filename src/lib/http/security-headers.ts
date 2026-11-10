/**
 * The response headers every response of the application carries.
 *
 * `src/proxy.ts` sets them on the responses it handles. A route that is left
 * out of the proxy's matcher (see `config.matcher` there) never passes through
 * it, so it adds the same set itself with `withBaseSecurityHeaders`. Both read
 * this one list, so the two cannot drift apart.
 *
 * The Content-Security-Policy is not part of it: pages get the nonce policy
 * from the proxy, and a route that returns user content sets its own.
 */
export const BASE_SECURITY_HEADERS: ReadonlyArray<readonly [name: string, value: string]> = [
	// Prevent clickjacking
	["X-Frame-Options", "SAMEORIGIN"],
	// Prevent MIME type sniffing
	["X-Content-Type-Options", "nosniff"],
	// Enable XSS filter in older browsers
	["X-XSS-Protection", "1; mode=block"],
	["Referrer-Policy", "strict-origin-when-cross-origin"],
	// Deny unnecessary features
	["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()"],
];

/** Sent only when the request itself arrived over HTTPS. */
export const STRICT_TRANSPORT_SECURITY = "max-age=31536000; includeSubDomains; preload";

/**
 * For a route outside the proxy: `response` with the base headers added. A
 * value the route set itself is kept (the proxy, which runs before the route,
 * has no such value to respect and overwrites).
 */
export function withBaseSecurityHeaders(response: Response, options: { https: boolean }): Response {
	const missing = (headers: Headers) => {
		const entries = BASE_SECURITY_HEADERS.filter(([name]) => !headers.has(name));
		if (options.https && !headers.has("Strict-Transport-Security")) {
			entries.push(["Strict-Transport-Security", STRICT_TRANSPORT_SECURITY]);
		}
		return entries;
	};
	try {
		for (const [name, value] of missing(response.headers)) response.headers.set(name, value);
		return response;
	} catch {
		// Immutable headers (Response.redirect(), a fetched response): copy.
		const headers = new Headers(response.headers);
		for (const [name, value] of missing(headers)) headers.set(name, value);
		return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
	}
}

/**
 * Structural validation for user-supplied post-login/post-action redirect
 * targets (`?next=…`, form fields).
 *
 * The classic check `startsWith("/") && !startsWith("//")` misses the
 * backslash form `/\evil.com`: WHATWG URL parsers normalize `\` to `/`, so
 * browsers resolve a `Location: /\evil.com` header — or an
 * `router.push("/\\evil.com")` — as the protocol-relative `//evil.com` and
 * bounce the freshly-authenticated user to an attacker site. Reject any
 * second-character slash in either direction, plus control characters that
 * could smuggle header/parser tricks into the emitted location value.
 */
export function safeRelativeRedirectPath(
	value: string | null | undefined,
	fallback = "/",
): string {
	const next = (value ?? "").trim();
	if (!next.startsWith("/")) return fallback;
	if (next.length >= 2 && (next[1] === "/" || next[1] === "\\")) return fallback;
	if (/[\u0000-\u001F\u007F]/.test(next)) return fallback;
	return next;
}

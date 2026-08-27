const NOTIFICATIONS_FALLBACK_PATH = "/notifications";

export function getSafeNotificationActionUrl(actionUrl: string | null | undefined) {
	if (!actionUrl) return NOTIFICATIONS_FALLBACK_PATH;

	const trimmed = actionUrl.trim();
	// Must be a same-origin absolute path. Reject protocol-relative ("//host"),
	// backslash tricks ("/\\host" — browsers fold "\" to "/", yielding
	// "//host" → external redirect), and control chars/tabs that could smuggle
	// past naive checks. actionUrl is rendered into <Link href=...>.
	if (
		!trimmed.startsWith("/") ||
		trimmed.startsWith("//") ||
		/[\\\x00-\x1f\x7f]/.test(trimmed)
	) {
		return NOTIFICATIONS_FALLBACK_PATH;
	}

	// Defense in depth: resolve against a sentinel origin and confirm the value
	// cannot escape it (no host/scheme). Same-origin paths keep this origin.
	try {
		const base = "http://localhost";
		if (new URL(trimmed, base).origin !== base) {
			return NOTIFICATIONS_FALLBACK_PATH;
		}
	} catch {
		return NOTIFICATIONS_FALLBACK_PATH;
	}

	return trimmed;
}

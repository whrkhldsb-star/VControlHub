/** Reads the JS-visible token used by the double-submit CSRF flow. */
export function getCsrfTokenFromCookie(): string | null {
	if (typeof document === "undefined") return null;
	const cookie = document.cookie
		.split(";")
		.map((value) => value.trim())
		.find((value) => value.startsWith("csrf_token="));
	if (!cookie) return null;
	return decodeURIComponent(cookie.split("=").slice(1).join("="));
}

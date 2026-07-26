/**
 * Shared HTML entity escaper. Single implementation used by markdown
 * preview, the AI markdown renderer, and the syntax highlighter so the
 * escaping behaviour (and its security review surface) lives in one place.
 */
export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

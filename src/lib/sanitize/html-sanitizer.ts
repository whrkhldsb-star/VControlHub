import createDOMPurify from "dompurify";
import type { Config } from "dompurify";

const MARKDOWN_SANITIZE_CONFIG: Config = {
	ALLOWED_TAGS: [
		"h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr",
		"strong", "em", "code", "pre", "a",
		"ul", "ol", "li", "blockquote",
		"table", "thead", "tbody", "tr", "th", "td",
	],
	ALLOWED_ATTR: ["href", "target", "rel", "class"],
	ALLOW_DATA_ATTR: false,
};

const HIGHLIGHT_SANITIZE_CONFIG: Config = {
	ALLOWED_TAGS: ["span", "br"],
	ALLOWED_ATTR: ["class"],
	ALLOW_DATA_ATTR: false,
};

function purifyHtml(html: string, config: Config): string {
	const purifier = typeof createDOMPurify.sanitize === "function"
		? createDOMPurify
		: typeof window !== "undefined"
			? createDOMPurify(window)
			: null;

	return purifier?.sanitize(html, config) ?? html;
}

export function sanitizeHtml(html: string): string {
	return purifyHtml(html, MARKDOWN_SANITIZE_CONFIG);
}

export function sanitizeHighlightHtml(html: string): string {
	return purifyHtml(html, HIGHLIGHT_SANITIZE_CONFIG);
}

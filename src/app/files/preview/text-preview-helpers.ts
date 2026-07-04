/**
 * Small pure helpers for the text file preview.
 *
 * Split out from `text-preview-client.tsx` so the orchestrator only
 * holds component state + render glue. Syntax-highlighting primitives
 * (getLangFromName, highlightLine, escapeHtml, escapeRegex,
 * buildLineDiff) live in `./syntax-highlighter`; shared types live in
 * `./text-preview-types`. This module holds the remaining pure
 * utilities that belong to neither: match counting for the in-editor
 * find bar, the editor tab indent unit, and language label resolution.
 */

/** A single tab character, used by the editor's Tab indent/unindent logic. */
export const TAB_INDENT = "\t";

/** Count non-overlapping occurrences of `query` in `text` (case-sensitive). */
export function countMatches(text: string, query: string): number {
	if (!query) return 0;
	let count = 0;
	let idx = text.indexOf(query);
	while (idx !== -1) {
		count += 1;
		idx = text.indexOf(query, idx + query.length);
	}
	return count;
}

const LANG_LABELS: Record<string, string> = {
	javascript: "JavaScript", typescript: "TypeScript", python: "Python", json: "JSON",
	yaml: "YAML", toml: "TOML/INI", shell: "Shell", html: "HTML", xml: "XML",
	css: "CSS", sql: "SQL", go: "Go", rust: "Rust", ruby: "Ruby", php: "PHP",
	c: "C", cpp: "C++", java: "Java", kotlin: "Kotlin", lua: "Lua",
};

/**
 * Resolve a human-readable label for a detected language. Prefers the
 * i18n translation key (`textPreview.type.<lang>`); falls back to the
 * static `LANG_LABELS` map, then the raw language id.
 */
export function langLabel(t: (k: string) => string, lang: string): string {
	const translated = t(`textPreview.type.${lang}`);
	return translated === `textPreview.type.${lang}` ? (LANG_LABELS[lang] ?? lang) : translated;
}

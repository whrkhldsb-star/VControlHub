import { escapeHtml, escapeRegex } from "./syntax-highlighter";

// These are the five entities emitted by escapeHtml. Decode exactly one layer so
// a literal entity in the source stays literal when the fragments are escaped again.
const entities: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

export function highlightSearchTerm(html: string, searchQuery: string): string {
	if (!searchQuery.trim()) return html;
	const query = new RegExp(`(${escapeRegex(searchQuery)})`, "gi");
	return html.split(/(<[^>]*>)/).map((part) => {
		if (part.startsWith("<")) return part;
		const text = part.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => entities[entity]!);
		return text.split(query).map((piece, index) => index % 2
			? `<mark class="bg-[var(--warning-bg)] text-[var(--warning)] rounded-lg px-0.5">${escapeHtml(piece)}</mark>`
			: escapeHtml(piece)).join("");
	}).join("");
}

import { escapeHtml, escapeRegex } from "./syntax-highlighter";

export function highlightSearchTerm(html: string, searchQuery: string): string {
	if (!searchQuery.trim()) return html;
	try {
		const escapedQuery = escapeHtml(searchQuery);
		const escaped = escapeRegex(escapedQuery);
		return html.replace(new RegExp(`(${escaped})`, "gi"), '<mark class="bg-[var(--warning-bg)] text-[var(--warning)] rounded-lg px-0.5">$1</mark>');
	} catch {
		return html;
	}
}

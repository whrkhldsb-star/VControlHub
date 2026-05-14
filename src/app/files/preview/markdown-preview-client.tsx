"use client";

import { useState, useEffect } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";

type PreviewState = { loading: true } | { loading: false; content: string | null; error: string | null };

/**
 * Simple regex-based Markdown-to-HTML converter.
 * Supports: headings, bold, italic, fenced code blocks, inline code,
 * links, ordered/unordered lists, blockquotes, tables, horizontal rules.
 */
function renderMarkdown(md: string): string {
	// Normalize line endings
	const src = md.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

	const lines = src.split("\n");
	const out: string[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		// ---- Fenced code block ----
		const fenceMatch = line.match(/^(`{3,})(.*)$/);
		if (fenceMatch) {
			const fence = fenceMatch[1];
			const lang = fenceMatch[2].trim();
			const codeLines: string[] = [];
			i++;
			while (i < lines.length && !lines[i].startsWith(fence)) {
				codeLines.push(lines[i]);
				i++;
			}
			i++; // skip closing fence
			const langClass = lang ? ` class="language-${escapeHtml(lang)}"` : "";
			out.push(`<pre><code${langClass}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
			continue;
		}

		// ---- Empty line ----
		if (line.trim() === "") {
			i++;
			continue;
		}

		// ---- Heading ----
		const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
		if (headingMatch) {
			const level = headingMatch[1].length;
			const text = inlineFormat(headingMatch[2]);
			out.push(`<h${level}>${text}</h${level}>`);
			i++;
			continue;
		}

		// ---- Horizontal rule ----
		if (/^(\s*[-*_]){3,}\s*$/.test(line)) {
			out.push("<hr />");
			i++;
			continue;
		}

		// ---- Table ----
		const tableBlock = tryParseTable(lines, i);
		if (tableBlock) {
			out.push(tableBlock.html);
			i = tableBlock.nextLine;
			continue;
		}

		// ---- Blockquote ----
		if (/^>\s?/.test(line)) {
			const quoteLines: string[] = [];
			while (i < lines.length && /^>\s?/.test(lines[i])) {
				quoteLines.push(lines[i].replace(/^>\s?/, ""));
				i++;
			}
			out.push(`<blockquote>${inlineFormat(quoteLines.join("\n"))}</blockquote>`);
			continue;
		}

		// ---- Unordered list ----
		if (/^[\s]*[-*+]\s+/.test(line)) {
			const items: string[] = [];
			while (i < lines.length && /^[\s]*[-*+]\s+/.test(lines[i])) {
				items.push(inlineFormat(lines[i].replace(/^[\s]*[-*+]\s+/, "")));
				i++;
			}
			out.push(`<ul>${items.map((it) => `<li>${it}</li>`).join("")}</ul>`);
			continue;
		}

		// ---- Ordered list ----
		if (/^[\s]*\d+\.\s+/.test(line)) {
			const items: string[] = [];
			while (i < lines.length && /^[\s]*\d+\.\s+/.test(lines[i])) {
				items.push(inlineFormat(lines[i].replace(/^[\s]*\d+\.\s+/, "")));
				i++;
			}
			out.push(`<ol>${items.map((it) => `<li>${it}</li>`).join("")}</ol>`);
			continue;
		}

		// ---- Paragraph (default) ----
		const paraLines: string[] = [];
		while (
			i < lines.length &&
			lines[i].trim() !== "" &&
			!/^#{1,6}\s/.test(lines[i]) &&
			!/^(\s*[-*_]){3,}\s*$/.test(lines[i]) &&
			!/^>\s?/.test(lines[i]) &&
			!/^[\s]*[-*+]\s+/.test(lines[i]) &&
			!/^[\s]*\d+\.\s+/.test(lines[i]) &&
			!/^`{3,}/.test(lines[i]) &&
			!isTableRow(lines[i])
		) {
			paraLines.push(lines[i]);
			i++;
		}
		if (paraLines.length > 0) {
			out.push(`<p>${inlineFormat(paraLines.join("<br />"))}</p>`);
		}
	}

	return out.join("\n");
}

/** Escape HTML special characters */
function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Apply inline Markdown formatting (bold, italic, code, links) */
function inlineFormat(text: string): string {
	// Inline code (must be before bold/italic to avoid conflicts)
	text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
	// Bold + italic
	text = text.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
	// Bold
	text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
	// Italic
	text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");
	// Sanitize link URLs to prevent javascript: protocol XSS
	text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
		const trimmed = url.trim().toLowerCase();
		if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:') || trimmed.startsWith('vbscript:')) {
			return match; // 不转换危险链接
		}
		return `<a href="${escapeHtml(url.trim())}" target="_blank" rel="noopener noreferrer">${text}</a>`;
	});
	return text;
}

/** Check if a line looks like a table row */
function isTableRow(line: string): boolean {
	return /^\|.*\|$/.test(line.trim());
}

/** Check if a line is a table separator row (|---|---|) */
function isTableSeparator(line: string): boolean {
	return /^\|[\s\-:]+\|/.test(line.trim());
}

/** Try to parse a table starting at line index `start`. Returns HTML + next line index, or null. */
function tryParseTable(lines: string[], start: number): { html: string; nextLine: number } | null {
	if (start >= lines.length || !isTableRow(lines[start])) return null;

	const headerLine = lines[start].trim();
	// Must have a separator row next
	if (start + 1 >= lines.length || !isTableSeparator(lines[start + 1])) return null;

	const headers = parseTableRow(headerLine);
	const aligns = parseTableAligns(lines[start + 1].trim());

	let i = start + 2;
	const bodyRows: string[][] = [];
	while (i < lines.length && isTableRow(lines[i])) {
		bodyRows.push(parseTableRow(lines[i].trim()));
		i++;
	}

	const headerHtml = headers
		.map((h, idx) => {
			const align = aligns[idx] ? ` style="text-align:${aligns[idx]}"` : "";
			return `<th${align}>${inlineFormat(h)}</th>`;
		})
		.join("");

	const bodyHtml = bodyRows
		.map((row) => {
			const cells = row
				.map((c, idx) => {
					const align = aligns[idx] ? ` style="text-align:${aligns[idx]}"` : "";
					return `<td${align}>${inlineFormat(c)}</td>`;
				})
				.join("");
			return `<tr>${cells}</tr>`;
		})
		.join("");

	return {
		html: `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`,
		nextLine: i,
	};
}

/** Split | cell | cell | into an array of trimmed cell strings */
function parseTableRow(line: string): string[] {
	return line
		.split("|")
		.slice(1, -1)
		.map((c) => c.trim());
}

/** Parse alignment from separator row: :---: = center, :--- = left, ---: = right */
function parseTableAligns(line: string): string[] {
	return line
		.split("|")
		.slice(1, -1)
		.map((c) => {
			const cell = c.trim();
			if (cell.startsWith(":") && cell.endsWith(":")) return "center";
			if (cell.endsWith(":")) return "right";
			if (cell.startsWith(":")) return "left";
			return "";
		});
}

export function MarkdownPreviewClient({ href }: { href: string }) {
	const [state, setState] = useState<PreviewState>({ loading: true });

	useEffect(() => {
		let cancelled = false;

		fetch(href)
			.then(async (res) => {
				if (!res.ok) throw new Error(`加载失败: ${res.status}`);
				const text = await res.text();
				if (!cancelled) {
					setState({ loading: false, content: text, error: null });
				}
			})
			.catch((err) => {
				if (!cancelled) {
					setState({
						loading: false,
						content: null,
						error: err instanceof Error ? err.message : "加载失败",
					});
				}
			});

		return () => {
			cancelled = true;
		};
	}, [href]);

	if (state.loading) {
		return (
			<div className="flex items-center justify-center py-16 text-slate-400">
				<span className="animate-pulse text-sm">正在加载…</span>
			</div>
		);
	}

	if (state.error) {
		return (
			<div className="flex flex-col items-center gap-3 py-16 text-red-300">
				<span className="text-3xl">⚠️</span>
				<p className="text-sm">{state.error}</p>
			</div>
		);
	}

	const html = renderMarkdown(state.content ?? "");

	return (
		<div className="overflow-auto rounded-2xl bg-slate-950 p-4">
			{/* Label */}
			<div className="mb-3 flex items-center gap-2">
				<span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-300">
					Markdown 预览
				</span>
			</div>

			{/* Rendered markdown */}
			<div
				className="prose prose-invert max-w-none text-sm leading-relaxed [&_a]:text-cyan-400 [&_a]:underline [&_a:hover]:text-cyan-300 [&_blockquote]:border-l-4 [&_blockquote]:border-slate-600 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-slate-400 [&_code]:rounded [&_code]:bg-slate-800 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-cyan-300 [&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-white [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-white [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-white [&_h4]:mt-3 [&_h4]:mb-1.5 [&_h4]:text-base [&_h4]:font-semibold [&_h4]:text-white [&_h5]:mt-3 [&_h5]:mb-1 [&_h5]:text-sm [&_h5]:font-semibold [&_h5]:text-white [&_h6]:mt-3 [&_h6]:mb-1 [&_h6]:text-sm [&_h6]:font-semibold [&_h6]:text-slate-300 [&_hr]:border-slate-700 [&_hr]:my-4 [&_li]:text-slate-200 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-2 [&_p]:my-2 [&_p]:text-slate-200 [&_pre]:rounded-xl [&_pre]:bg-slate-900 [&_pre]:p-4 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-slate-800 [&_strong]:text-white [&_strong]:font-semibold [&_table]:w-full [&_table]:my-3 [&_table]:border-collapse [&_td]:border [&_td]:border-slate-700 [&_td]:px-3 [&_td]:py-2 [&_td]:text-slate-200 [&_th]:border [&_th]:border-slate-700 [&_th]:bg-slate-900 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:text-white [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-2"
				dangerouslySetInnerHTML={{ __html: html }}
			/>
		</div>
	);
}

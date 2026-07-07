"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n/use-locale";

type CsvState = { loading: true } | { loading: false; rows: string[][] | null; error: string | null; raw: string | null };

function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let current = 0;
	const len = text.length;

	function parseField(): string {
		if (current >= len) return "";
		if (text[current] === '"') {
			current++; // skip opening quote
			let field = "";
			while (current < len) {
				if (text[current] === '"') {
					if (current + 1 < len && text[current + 1] === '"') {
						field += '"';
						current += 2;
					} else {
						current++; // skip closing quote
						break;
					}
				} else {
					field += text[current];
					current++;
				}
			}
			return field;
		} else {
			let field = "";
			while (current < len && text[current] !== "," && text[current] !== "\n" && text[current] !== "\r") {
				field += text[current];
				current++;
			}
			return field.trim();
		}
	}

	function parseRow(): string[] {
		const fields: string[] = [];
		while (current < len) {
			fields.push(parseField());
			if (current < len && text[current] === ",") {
				current++;
			} else {
				break;
			}
		}
		// skip newline
		if (current < len && text[current] === "\r") current++;
		if (current < len && text[current] === "\n") current++;
		return fields;
	}

	while (current < len) {
		const row = parseRow();
		if (row.length > 0 && !(row.length === 1 && row[0] === "")) {
			rows.push(row);
		}
	}
	return rows;
}

export function CsvPreviewClient({ href }: { href: string }) {
	const { t } = useI18n();
	const [state, setState] = useState<CsvState>({ loading: true });

	useEffect(() => {
		let cancelled = false;
		fetch(href)
			.then(async (res) => {
				if (!res.ok) throw new Error(t("csvPreview.loadFailedWithStatus").replace("{status}", String(res.status)));
				const text = await res.text();
				if (!cancelled) {
					try {
						const rows = parseCsv(text);
						setState({ loading: false, rows, error: null, raw: text });
					} catch (err) {
						setState({ loading: false, rows: null, error: err instanceof Error ? err.message : t("csvPreview.parseFailed"), raw: null });
					}
				}
			})
			.catch((err) => {
				if (!cancelled) {
					setState({ loading: false, rows: null, error: err instanceof Error ? err.message : t("csvPreview.loadFailed"), raw: null });
				}
			});
		return () => { cancelled = true; };
	}, [href, t]);

	const maxRows = 500;
	const header = state.loading ? [] : (state.rows?.[0] ?? []);
	const dataRows = state.loading ? [] : (state.rows?.slice(1) ?? []);
	const displayRows = dataRows.slice(0, maxRows);
	const truncated = dataRows.length > maxRows;
	const colCount = header.length || (displayRows[0]?.length ?? 0);

	if (state.loading) {
		return (
			<div className="flex items-center justify-center py-16 text-[var(--text-secondary)]">
				<span className="animate-pulse text-sm">{t("csvPreview.loading")}</span>
			</div>
		);
	}

	if (state.error) {
		return (
			<div className="flex flex-col items-center gap-3 py-16 text-[var(--danger)]">
				<span className="text-3xl">⚠️</span>
				<p className="text-sm">{state.error}</p>
			</div>
		);
	}

	if (!state.rows || state.rows.length === 0) {
		return (
			<div className="flex flex-col items-center gap-3 py-16 text-[var(--text-secondary)]">
				<span className="text-3xl">📊</span>
				<p className="text-sm">{t("csvPreview.empty")}</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-3">
				<span className="rounded-full bg-[var(--success-bg)] px-3 py-1 text-xs font-medium text-[var(--success)] border border-[var(--success-border)]">{t("csvPreview.tableBadge")}</span>
				<span className="text-xs text-[var(--text-secondary)]">{t("csvPreview.rowCol").replace("{rows}", String(dataRows.length)).replace("{cols}", String(colCount))}</span>
			</div>
			<div className="overflow-auto rounded-2xl border border-[var(--border)]">
				<table className="w-full text-sm">
					<thead>
						<tr className="bg-[var(--surface)] light:bg-[var(--surface)]/80">
							<th className="px-3 py-2 text-left text-xs font-medium text-[var(--text-secondary)] border-b border-[var(--border)] w-12">#</th>
							{header.map((col, i) => (
								<th key={i} className="px-3 py-2 text-left text-xs font-medium text-[var(--color-action)] border-b border-[var(--border)] whitespace-nowrap">{col || t("csvPreview.colIndex").replace("{index}", String(i + 1))}</th>
							))}
						</tr>
					</thead>
					<tbody>
						{displayRows.map((row, rowIdx) => (
							<tr key={rowIdx} className={rowIdx % 2 === 0 ? "bg-[var(--surface)]/70" : "bg-[var(--surface-subtle)]/60"}>
								<td className="px-3 py-1.5 text-right text-xs text-[var(--text-muted)] border-b border-[var(--border)] light:border-[var(--border)]">{rowIdx + 1}</td>
								{header.map((_, colIdx) => (
									<td key={colIdx} className="px-3 py-1.5 text-[var(--text-secondary)] border-b border-[var(--border)] light:border-[var(--border)] whitespace-nowrap max-w-[300px] truncate">{row[colIdx] ?? ""}</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{truncated ? (
				<div data-tone="amber" className="rounded-2xl border border-[var(--warning-border)] px-4 py-3 text-sm text-[var(--warning)]">
					{t("csvPreview.largeWarning").replace("{max}", String(maxRows)).replace("{total}", String(dataRows.length))}
				</div>
			) : null}
		</div>
	);
}

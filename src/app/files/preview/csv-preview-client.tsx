"use client";

import { useState, useEffect } from "react";

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
	const [state, setState] = useState<CsvState>({ loading: true });

	useEffect(() => {
		let cancelled = false;
		fetch(href)
			.then(async (res) => {
				if (!res.ok) throw new Error(`加载失败: ${res.status}`);
				const text = await res.text();
				if (!cancelled) {
					try {
						const rows = parseCsv(text);
						setState({ loading: false, rows, error: null, raw: text });
					} catch (err) {
						setState({ loading: false, rows: null, error: err instanceof Error ? err.message : "CSV 解析失败", raw: null });
					}
				}
			})
			.catch((err) => {
				if (!cancelled) {
					setState({ loading: false, rows: null, error: err instanceof Error ? err.message : "加载失败", raw: null });
				}
			});
		return () => { cancelled = true; };
	}, [href]);

	const maxRows = 500;
	const header = state.loading ? [] : (state.rows?.[0] ?? []);
	const dataRows = state.loading ? [] : (state.rows?.slice(1) ?? []);
	const displayRows = dataRows.slice(0, maxRows);
	const truncated = dataRows.length > maxRows;
	const colCount = header.length || (displayRows[0]?.length ?? 0);

	if (state.loading) {
		return (
			<div className="flex items-center justify-center py-16 text-[var(--text-secondary)]">
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

	if (!state.rows || state.rows.length === 0) {
		return (
			<div className="flex flex-col items-center gap-3 py-16 text-[var(--text-secondary)]">
				<span className="text-3xl">📊</span>
				<p className="text-sm">CSV 文件为空</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-3">
				<span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300 border border-emerald-400/30">CSV 表格预览</span>
				<span className="text-xs text-[var(--text-secondary)]">{dataRows.length} 行 × {colCount} 列</span>
			</div>
			<div className="overflow-auto rounded-2xl border border-[var(--border)]">
				<table className="w-full text-sm">
					<thead>
						<tr className="bg-slate-800/80 light:bg-slate-100/80">
							<th className="px-3 py-2 text-left text-xs font-medium text-[var(--text-secondary)] border-b border-slate-700 w-12">#</th>
							{header.map((col, i) => (
								<th key={i} className="px-3 py-2 text-left text-xs font-medium text-cyan-300 border-b border-slate-700 whitespace-nowrap">{col || `列${i + 1}`}</th>
							))}
						</tr>
					</thead>
					<tbody>
						{displayRows.map((row, rowIdx) => (
							<tr key={rowIdx} className={rowIdx % 2 === 0 ? "bg-slate-900/40" : "bg-slate-950/40"}>
								<td className="px-3 py-1.5 text-right text-xs text-slate-600 border-b border-slate-800/50 light:border-slate-300/50">{rowIdx + 1}</td>
								{header.map((_, colIdx) => (
									<td key={colIdx} className="px-3 py-1.5 text-[var(--text-secondary)] border-b border-slate-800/50 light:border-slate-300/50 whitespace-nowrap max-w-[300px] truncate">{row[colIdx] ?? ""}</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{truncated ? (
				<div className="rounded-2xl border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm text-amber-200">
					⚠ 数据量较大，仅显示前 {maxRows} 行（共 {dataRows.length} 行）。建议下载后使用专业工具查看。
				</div>
			) : null}
		</div>
	);
}

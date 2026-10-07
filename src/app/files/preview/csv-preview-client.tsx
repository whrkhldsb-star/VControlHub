"use client";

import { useI18n } from "@/lib/i18n/use-locale";
import { getErrorMessage } from "@/lib/http/error-message";
import { apiRequest } from "@/lib/http/api-client";
import { useEffect, useState } from "react";
import { readDelimitedPreview, tableDelimiter } from "@/lib/storage/delimited-preview";
import { AlertTriangle, File } from "@/components/icons";
import { StatusBadge } from "@/components/status-badge";
import { InlineLoading, Notice } from "@/components/ui-primitives";


export function CsvPreviewClient({ href, name = "", mimeType = "" }: { href: string; name?: string; mimeType?: string }) {
	const { t } = useI18n();
	const delimiter = tableDelimiter(name, mimeType);
	const [state, setState] = useState<{ loading: boolean; rows: string[][]; truncated: boolean; error: string | null }>({ loading: true, rows: [], truncated: false, error: null });
	useEffect(() => {
		const controller = new AbortController();
		const timer = window.setTimeout(() => {
			setState({ loading: true, rows: [], truncated: false, error: null });
			void (async () => {
				try {
					const response = await apiRequest<Response>(href, { signal: controller.signal, raw: true });
					if (!response.ok) { await response.body?.cancel(); throw new Error(t("csvPreview.loadFailedWithStatus", { status: response.status })); }
					const preview = await readDelimitedPreview(response, delimiter, controller.signal);
					if (!controller.signal.aborted) setState({ loading: false, ...preview, error: null });
				} catch (error) {
					if (!controller.signal.aborted) {
						const message = getErrorMessage(error, t("csvPreview.parseFailed"));
						setState({ loading: false, rows: [], truncated: false, error: message.startsWith("csvPreview.") ? t(message) : message });
					}
				}
			})();
		}, 0);
		return () => { window.clearTimeout(timer); controller.abort(); };
	}, [href, delimiter, t]);
	const colCount = Math.max(0, ...state.rows.map((row) => row.length));
	const header = Array.from({ length: colCount }, (_, index) => state.rows[0]?.[index] ?? "");
	const dataRows = state.rows.slice(1);
	const displayRows = dataRows;
	const truncated = state.truncated;

	if (state.loading) {
		return <InlineLoading label={t("csvPreview.loading")} className="py-16" />;
	}

	if (state.error) {
		return (
			<div className="flex flex-col items-center gap-3 py-16 text-[var(--danger)]">
				<AlertTriangle size={32} aria-hidden="true" />
				<p className="text-sm">{state.error}</p>
			</div>
		);
	}

	if (state.rows.length === 0 && !truncated) {
		return (
			<div className="flex flex-col items-center gap-3 py-16 text-[var(--text-secondary)]">
				<File size={32} aria-hidden="true" />
				<p className="text-sm">{t("csvPreview.empty")}</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-3">
				<StatusBadge size="md" tone="success">{t("csvPreview.tableBadge")}</StatusBadge>
				<span className="text-xs text-[var(--text-secondary)]">{t("csvPreview.rowCol", { rows: dataRows.length, cols: colCount })}</span>
			</div>
			<div className="overflow-auto rounded-2xl border border-[var(--border)]">
				<table className="w-full text-sm">
					<thead>
						<tr className="bg-[var(--surface)] light:bg-[var(--surface)]/80">
							<th className="px-3 py-2 text-left text-xs font-medium text-[var(--text-secondary)] border-b border-[var(--border)] w-12">#</th>
							{header.map((col, i) => (
								<th key={i} className="px-3 py-2 text-left text-xs font-medium text-[var(--color-action-text)] border-b border-[var(--border)] whitespace-nowrap">{col || t("csvPreview.colIndex", { index: i + 1 })}</th>
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
				<Notice tone="warning">
					{t("csvPreview.boundedWarning")}
				</Notice>
			) : null}
		</div>
	);
}

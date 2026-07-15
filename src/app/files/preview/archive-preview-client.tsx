"use client";

import { useState, useTransition } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

type ArchiveEntry = {
	name: string;
	size: number;
	isDirectory: boolean;
	modified?: string;
};

export function ArchivePreviewClient({
	name,
	nodeId,
	relativePath,
	driver,
}: {
	name: string;
	nodeId: string;
	relativePath: string;
	driver: string;
}) {
	const { t } = useI18n();
	const [entries, setEntries] = useState<ArchiveEntry[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [extracting, startExtractTransition] = useTransition();
	const [extractResult, setExtractResult] = useState<string | null>(null);

	async function loadArchiveContents() {
		setLoading(true);
		setError(null);
		try {
			const params = new URLSearchParams({
				nodeId,
				relativePath,
				driver,
				name,
			});
			const data = await csrfFetch(`/api/files/archive-list?${params.toString()}`);
			setEntries(data.entries ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("archivePreview.unknownError"));
		} finally {
			setLoading(false);
		}
	}

	function handleExtract() {
		startExtractTransition(async () => {
			setExtractResult(null);
			try {
				const data = await csrfFetch("/api/files/extract", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ nodeId, relativePath, driver, name }),
				});
				if (data.error) throw new Error(data.error);
				setExtractResult(data.message || t("archivePreview.extractDone"));
				} catch (err) {
				setExtractResult(err instanceof Error ? err.message : t("archivePreview.extractFailed"));
				}
		});
	}

	function formatSize(bytes: number) {
		if (bytes === 0) return "-";
		const units = ["B", "KB", "MB", "GB"];
		let i = 0;
		let size = bytes;
		while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
		return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
	}

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-3">
				<button
					type="button"
					onClick={loadArchiveContents}
					disabled={loading}
					data-tone="cyan" className="rounded-xl border border-[var(--color-action-border)]/30 px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--color-action-bg)]/20 disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{loading ? t("archivePreview.loading") : entries ? t("archivePreview.refreshList") : t("archivePreview.title")}
				</button>
				{entries && entries.length > 0 && driver === "LOCAL" ? (
					<button
						type="button"
						onClick={handleExtract}
						disabled={extracting}
						data-tone="emerald" className="rounded-xl border border-[var(--success-border)] px-4 py-2 text-sm font-medium text-[var(--success)] transition hover:bg-[var(--success-bg)] disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{extracting ? t("archivePreview.extracting") : t("archivePreview.extract")}
					</button>
				) : null}
			</div>

			{error ? (
				<div data-tone="rose" className="rounded-2xl border border-[var(--danger-border)] px-4 py-3 text-sm text-[var(--danger)]">
					{error}
				</div>
			) : null}

			{extractResult ? (
				<div data-tone="emerald" className="rounded-2xl border border-[var(--success-border)] px-4 py-3 text-sm text-[var(--success)]">
					{extractResult}
				</div>
			) : null}

			{entries && entries.length > 0 ? (
				<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] overflow-hidden">
					<div className="grid grid-cols-[auto_minmax(0,2fr)_100px] gap-4 bg-[var(--surface)]/10 px-4 py-2.5 text-xs uppercase tracking-wider text-[var(--text-secondary)] font-medium">
						<div />
						<div>{t("archivePreview.table.name")}</div>
						<div className="text-right">{t("archivePreview.table.size")}</div>
					</div>
					<div className="divide-y divide-[var(--border-subtle)] light:divide-[var(--border)] max-h-[50vh] overflow-y-auto">
						{entries.map((entry, i) => (
							<div
								key={`${entry.name}-${i}`}
								className="grid grid-cols-[auto_minmax(0,2fr)_100px] gap-4 items-center px-4 py-2 text-sm hover:bg-[var(--surface-elevated)] transition"
							>
								<div className="text-[var(--text-muted)]">
									{entry.isDirectory ? (
										<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
									) : (
										<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
									)}
								</div>
								<div className="truncate text-[var(--text-primary)]">{entry.name}</div>
								<div className="text-right text-[var(--text-secondary)] text-xs">{entry.isDirectory ? t("archivePreview.entryType.directory") : formatSize(entry.size)}</div>
							</div>
						))}
					</div>
					<div className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--border)]">
						{t("archivePreview.totalItems").replace("{count}", String(entries.length))}
					</div>
				</div>
			) : entries && entries.length === 0 ? (
				<div className="text-sm text-[var(--text-secondary)]">{t("archivePreview.empty")}</div>
			) : null}
		</div>
	);
}

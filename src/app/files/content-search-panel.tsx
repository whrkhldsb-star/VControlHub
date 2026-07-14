"use client";

import { useState, useCallback } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { csrfFetch } from "@/lib/auth/csrf-client";

export type ContentSearchHit = {
	filePath: string;
	relativePath: string;
	nodeId: string;
	nodeName: string;
	nodeDriver: string;
	snippets: string[];
};

type ContentSearchResponse = {
	results: ContentSearchHit[];
	totalMatches: number;
	truncated: boolean;
};

/**
 * FEAT-P0-4: Content search panel.
 *
 * Shows a toggle between "filename" and "content" search modes.
 * In content mode, fetches results from /api/files/search-content
 * and displays matching files with code snippets.
 */
export function ContentSearchPanel({
	searchInput,
	nodeId,
	searchPath,
}: {
	searchInput: string;
	nodeId?: string;
	searchPath?: string;
}) {
	const { t } = useI18n();
	const [mode, setMode] = useState<"filename" | "content">("filename");
	const [contentResults, setContentResults] = useState<ContentSearchHit[]>([]);
	const [contentLoading, setContentLoading] = useState(false);
	const [contentError, setContentError] = useState("");
	const [contentTruncated, setContentTruncated] = useState(false);
	const [lastQuery, setLastQuery] = useState("");

	const handleContentSearch = useCallback(async () => {
		const query = searchInput.trim();
		if (!query) return;

		setContentLoading(true);
		setContentError("");
		setContentResults([]);
		setLastQuery(query);

		try {
			const params = new URLSearchParams({ q: query });
			if (nodeId) params.set("nodeId", nodeId);
			if (searchPath) params.set("path", searchPath);

			const data: ContentSearchResponse = await csrfFetch(
				`/api/files/search-content?${params}`,
			);

			setContentResults(data.results);
			setContentTruncated(data.truncated);
		} catch {
			setContentError(t("filesBrowserSpa.contentSearchError"));
		} finally {
			setContentLoading(false);
		}
	}, [searchInput, nodeId, searchPath, t]);

	// Only render the toggle, not the results (results are shown by parent)
	if (mode === "filename") {
		return (
			<div className="flex items-center gap-2">
				<div className="flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-1">
					<button
						type="button"
						onClick={() => setMode("filename")}
						className="rounded-full px-3 py-1 text-xs font-medium text-[var(--text-primary)] border border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10"
					>
						{t("filesBrowserSpa.searchModeFilename")}
					</button>
					<button
						type="button"
						onClick={() => setMode("content")}
						className="rounded-full px-3 py-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
					>
						{t("filesBrowserSpa.searchModeContent")}
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2">
				<div className="flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-1">
					<button
						type="button"
						onClick={() => setMode("filename")}
						className="rounded-full px-3 py-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
					>
						{t("filesBrowserSpa.searchModeFilename")}
					</button>
					<button
						type="button"
						onClick={() => setMode("content")}
						className="rounded-full px-3 py-1 text-xs font-medium text-[var(--text-primary)] border border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10"
					>
						{t("filesBrowserSpa.searchModeContent")}
					</button>
				</div>
				<button
					type="button"
					onClick={handleContentSearch}
					disabled={contentLoading || !searchInput.trim()}
					className="rounded-lg border border-[var(--color-action-border)]/30 px-4 py-1.5 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--color-action-bg)]/20 disabled:opacity-50"
				>
					{contentLoading ? t("filesBrowserSpa.contentSearching") : t("filesBrowserSpa.searchLabel")}
				</button>
			</div>

			{contentError && (
				<div className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-2 text-xs text-[var(--danger)]">
					{contentError}
				</div>
			)}

			{contentResults.length > 0 && (
				<div className="space-y-2">
					<p className="text-xs text-[var(--text-secondary)]">
						{t("filesBrowserSpa.contentSearchResults")
							.replace("{query}", lastQuery)
							.replace("{count}", String(contentResults.length))}
						{contentTruncated ? t("filesBrowserSpa.contentSearchTruncated") : ""}
					</p>
					{contentResults.map((hit, idx) => (
						<div
							key={`${hit.nodeId}-${hit.relativePath}-${idx}`}
							className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-3"
						>
							<div className="mb-1.5 flex items-center gap-2">
								<span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
									{hit.nodeName}
								</span>
								<span className="truncate text-sm font-medium text-[var(--text-primary)]">
									{hit.relativePath || hit.filePath}
								</span>
							</div>
							<div className="space-y-1">
								{hit.snippets.map((snippet, i) => (
									<pre
										key={i}
										className="overflow-x-auto rounded-lg bg-[color-mix(in_srgb,var(--surface-subtle)_85%,#000)] p-2 text-[11px] text-[var(--text-secondary)] font-mono whitespace-pre-wrap"
									>
										{snippet}
									</pre>
								))}
							</div>
						</div>
					))}
				</div>
			)}

			{!contentLoading && contentResults.length === 0 && lastQuery && !contentError && (
				<p className="text-xs text-[var(--text-muted)]">
					{t("filesBrowserSpa.contentSearchNoResults").replace("{query}", lastQuery)}
				</p>
			)}
		</div>
	);
}

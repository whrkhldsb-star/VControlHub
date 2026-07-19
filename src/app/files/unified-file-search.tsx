"use client";

import { useCallback, useState } from "react";
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
 * Unified search bar for the files browser.
 *
 * Replaces the old split between `SearchScopeToggle` + filename form +
 * `ContentSearchPanel` toggle. Users now see a single search input with
 * a clear mode selector: "文件名" (filename) vs "内容" (content), and for
 * filename mode a scope selector: "当前目录" vs "全部".
 *
 * - In **filename** mode, pressing Enter / Search delegates to the parent's
 *   `onFilenameSearch` callback (which calls `fetchFiles` with the query).
 * - In **content** mode, pressing Enter / Search fetches content results
 *   directly from `/api/files/search-content` and displays snippets.
 */
export function UnifiedFileSearch({
	searchInput,
	onSearchInputChange,
	onFilenameSearch,
	nodeId,
	searchPath,
}: {
	searchInput: string;
	onSearchInputChange: (value: string) => void;
	onFilenameSearch: (scope: "current" | "all") => void;
	nodeId?: string;
	searchPath?: string;
}) {
	const { t } = useI18n();
	const [mode, setMode] = useState<"filename" | "content">("filename");
	const [scope, setScope] = useState<"current" | "all">("current");
	const [contentResults, setContentResults] = useState<ContentSearchHit[]>([]);
	const [contentLoading, setContentLoading] = useState(false);
	const [contentError, setContentError] = useState("");
	const [contentTruncated, setContentTruncated] = useState(false);
	const [lastQuery, setLastQuery] = useState("");

	const handleSearch = useCallback(
		(e: React.FormEvent) => {
			e.preventDefault();
			const query = searchInput.trim();
			if (!query) return;

			if (mode === "filename") {
				onFilenameSearch(scope);
				return;
			}

			// Content search
			setContentLoading(true);
			setContentError("");
			setContentResults([]);
			setLastQuery(query);

			(async () => {
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
			})();
		},
		[searchInput, mode, scope, onFilenameSearch, nodeId, searchPath, t],
	);

	return (
		<div className="space-y-3">
			{/* Mode + scope selector row */}
			<div className="flex flex-wrap items-center gap-2">
				{/* Mode toggle: filename vs content */}
				<div className="flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-1">
					<button
						type="button"
						onClick={() => setMode("filename")}
						className={`rounded-full px-3 py-1 text-xs font-medium transition ${
							mode === "filename"
								? "border border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]"
								: "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
						}`}
					>
						{t("filesBrowserSpa.searchModeFilename")}
					</button>
					<button
						type="button"
						onClick={() => setMode("content")}
						className={`rounded-full px-3 py-1 text-xs font-medium transition ${
							mode === "content"
								? "border border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]"
								: "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
						}`}
					>
						{t("filesBrowserSpa.searchModeContent")}
					</button>
				</div>

				{/* Scope toggle: only visible in filename mode */}
				{mode === "filename" && (
					<div className="flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-1">
						<button
							type="button"
							onClick={() => setScope("current")}
							className={`rounded-full px-3 py-1 text-xs font-medium transition ${
								scope === "current"
									? "border border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]"
									: "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
							}`}
						>
							{t("filesPage.searchScope.current")}
						</button>
						<button
							type="button"
							onClick={() => setScope("all")}
							className={`rounded-full px-3 py-1 text-xs font-medium transition ${
								scope === "all"
									? "border border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]"
									: "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
							}`}
						>
							{t("filesPage.searchScope.all")}
						</button>
					</div>
				)}
			</div>

			{/* Search input + button */}
			<form onSubmit={handleSearch} className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
				<div className="flex flex-1 flex-col gap-1">
					<label htmlFor="files-search-query" className="text-xs font-medium text-[var(--text-secondary)]">
						{mode === "filename"
							? t("filesBrowserSpa.searchFileName")
							: t("filesBrowserSpa.searchModeContent")}
					</label>
					<input
						id="files-search-query"
						type="text"
						value={searchInput}
						onChange={(e) => onSearchInputChange(e.currentTarget.value)}
						placeholder={
							mode === "filename"
								? scope === "all"
									? t("filesBrowserSpa.searchAllFiles")
									: t("filesBrowserSpa.searchCurrentFolder")
								: t("filesBrowserSpa.contentSearchPlaceholder")
						}
						data-input
						className="rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--input-border-focus)] focus:shadow-[0_0_0_3px_var(--input-ring)] focus:outline-none"
					/>
				</div>
				<button
					type="submit"
					data-action-button
					data-variant="primary"
					className="px-5 py-2.5 text-sm"
					disabled={!searchInput.trim() || contentLoading}
				>
					{contentLoading && mode === "content"
						? t("filesBrowserSpa.contentSearching")
						: t("filesBrowserSpa.searchLabel")}
				</button>
			</form>

			{/* Content search results */}
			{mode === "content" && contentError && (
				<div className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-2 text-xs text-[var(--danger)]">
					{contentError}
				</div>
			)}

			{mode === "content" && contentResults.length > 0 && (
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

			{mode === "content" && !contentLoading && contentResults.length === 0 && lastQuery && !contentError && (
				<p className="text-xs text-[var(--text-muted)]">
					{t("filesBrowserSpa.contentSearchNoResults").replace("{query}", lastQuery)}
				</p>
			)}
		</div>
	);
}

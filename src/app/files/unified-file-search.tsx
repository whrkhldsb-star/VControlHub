"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { ActionButton } from "@/components/action-button";
import { StatusBadge } from "@/components/status-badge";
import { Notice, SegmentedControl } from "@/components/ui-primitives";
import { UI_INPUT, UI_LABEL } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";

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

export type ContentSearchState = {
	results: ContentSearchHit[];
	loading: boolean;
	error: string;
	truncated: boolean;
	/** The query the shown results answer; "" before the first search. */
	lastQuery: string;
};

/**
 * Full-text search requests. A newer search, `reset` and unmount each abort
 * the request in flight, and an answer that arrives late is dropped, so the
 * results always belong to the newest query.
 */
export function useContentSearch({ nodeId, searchPath }: { nodeId?: string; searchPath?: string }) {
	const { t } = useI18n();
	const [state, setState] = useState<ContentSearchState>({ results: [], loading: false, error: "", truncated: false, lastQuery: "" });
	const abortRef = useRef<AbortController | null>(null);
	const requestRef = useRef(0);

	const reset = useCallback(() => {
		abortRef.current?.abort();
		requestRef.current += 1;
		setState({ results: [], loading: false, error: "", truncated: false, lastQuery: "" });
	}, []);

	useEffect(() => () => {
		abortRef.current?.abort();
		requestRef.current += 1;
	}, []);

	const run = useCallback((query: string) => {
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		const requestId = ++requestRef.current;
		setState({ results: [], loading: true, error: "", truncated: false, lastQuery: query });
		void (async () => {
			try {
				const params = new URLSearchParams({ q: query });
				if (nodeId) params.set("nodeId", nodeId);
				if (searchPath) params.set("path", searchPath);
				const data: ContentSearchResponse = await csrfFetch(`/api/files/search-content?${params}`, { signal: controller.signal });
				if (requestId !== requestRef.current) return;
				setState({ results: data.results, loading: false, error: "", truncated: data.truncated, lastQuery: query });
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") return;
				if (requestId !== requestRef.current) return;
				setState({ results: [], loading: false, error: t("filesBrowserSpa.contentSearchError"), truncated: false, lastQuery: query });
			}
		})();
	}, [nodeId, searchPath, t]);

	return { state, run, reset };
}

/** Matches of a content search, with their snippets. */
export function ContentSearchResults({ state, onOpen }: {
	state: ContentSearchState;
	/** Open the folder of a hit; without it the hits are plain text. */
	onOpen?: (hit: ContentSearchHit) => void;
}) {
	const { t } = useI18n();
	if (state.error) return <Notice tone="danger" compact>{state.error}</Notice>;
	if (!state.loading && state.lastQuery && state.results.length === 0) {
		return <p className="text-xs text-[var(--text-muted)]">{t("filesBrowserSpa.contentSearchNoResults", { query: state.lastQuery })}</p>;
	}
	if (state.results.length === 0) return null;
	return (
		<div className="space-y-2">
			<p className="text-xs text-[var(--text-secondary)]">
				{t("filesBrowserSpa.contentSearchResults", { query: state.lastQuery, count: state.results.length })}
				{state.truncated ? t("filesBrowserSpa.contentSearchTruncated") : ""}
			</p>
			{state.results.map((hit, idx) => (
				<div key={`${hit.nodeId}-${hit.relativePath}-${idx}`} data-inset className="p-3">
					<div className="mb-1.5 flex min-w-0 items-center gap-2">
						<StatusBadge size="sm" tone="neutral">{hit.nodeName}</StatusBadge>
						{onOpen ? (
							<button type="button" onClick={() => onOpen(hit)} className="min-w-0 truncate text-left text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)]">
								{hit.relativePath || hit.filePath}
							</button>
						) : (
							<span className="truncate text-sm font-medium text-[var(--text-primary)]">{hit.relativePath || hit.filePath}</span>
						)}
					</div>
					<div className="space-y-1">
						{hit.snippets.map((snippet, i) => (
							<pre key={i} className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-[color-mix(in_srgb,var(--surface-subtle)_85%,#000)] p-2 font-mono text-xs text-[var(--text-secondary)]">
								{snippet}
							</pre>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

/**
 * Unified search bar for the search subpage: one input, a mode selector
 * (filename / content) and, for filenames, a scope selector (current folder /
 * everything). Filename searches go to `onFilenameSearch`; content searches
 * run here and list their matches below.
 */
export function UnifiedFileSearch({
	searchInput,
	onSearchInputChange,
	onFilenameSearch,
	nodeId,
	searchPath,
	initialScope = "current",
	inputRef,
}: {
	searchInput: string;
	onSearchInputChange: (value: string) => void;
	onFilenameSearch: (scope: "current" | "all") => void;
	nodeId?: string;
	searchPath?: string;
	initialScope?: "current" | "all";
	/** Allows the browser shell to implement the familiar `/` shortcut. */
	inputRef?: RefObject<HTMLInputElement | null>;
}) {
	const { t } = useI18n();
	const [mode, setMode] = useState<"filename" | "content">("filename");
	const [scope, setScope] = useState<"current" | "all">(initialScope);
	const content = useContentSearch({ nodeId, searchPath });

	const changeMode = (nextMode: "filename" | "content") => {
		if (nextMode === mode) return;
		content.reset();
		setMode(nextMode);
	};

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-2">
				<SegmentedControl
					size="sm"
					ariaLabel={t("filesBrowserSpa.searchModeLabel")}
					value={mode}
					onChange={changeMode}
					options={[
						{ value: "filename", label: t("filesBrowserSpa.searchModeFilename") },
						{ value: "content", label: t("filesBrowserSpa.searchModeContent") },
					]}
				/>
				{mode === "filename" && (
					<SegmentedControl
						size="sm"
						ariaLabel={t("filesBrowserSpa.searchScopeLabel")}
						value={scope}
						onChange={setScope}
						options={[
							{ value: "current", label: t("filesPage.searchScope.current") },
							{ value: "all", label: t("filesPage.searchScope.all") },
						]}
					/>
				)}
			</div>

			<form
				onSubmit={(event) => {
					event.preventDefault();
					const query = searchInput.trim();
					if (!query) return;
					if (mode === "filename") onFilenameSearch(scope);
					else content.run(query);
				}}
				className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3"
			>
				<div className="flex flex-1 flex-col gap-1">
					<label htmlFor="files-search-query" className={UI_LABEL}>
						{mode === "filename" ? t("filesBrowserSpa.searchFileName") : t("filesBrowserSpa.searchModeContent")}
					</label>
					<input
						ref={inputRef}
						id="files-search-query"
						type="search"
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
						className={cn(UI_INPUT, "px-4")}
					/>
				</div>
				<ActionButton variant="primary" type="submit" disabled={!searchInput.trim() || content.state.loading}>
					{content.state.loading && mode === "content" ? t("filesBrowserSpa.contentSearching") : t("filesBrowserSpa.searchLabel")}
				</ActionButton>
			</form>

			{mode === "content" ? <ContentSearchResults state={content.state} /> : null}
		</div>
	);
}

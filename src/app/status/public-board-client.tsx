"use client";

/**
 * Anonymous status board (client part). The server renders the first page
 * from the same projection; this component keeps it fresh by polling
 * `/api/status/board` — the only endpoint it calls.
 */
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { ActionButton, ButtonLink } from "@/components/action-button";
import { LanguageToggle } from "@/components/language-toggle";
import { ToggleChip } from "@/components/page-shell";
import { SegmentedControl } from "@/components/ui-primitives";
import { ThemeToggle } from "@/components/theme-toggle";
import { writeLocalStorageValue } from "@/lib/browser-storage";
import { UI_INPUT } from "@/lib/ui/classes";
import { useBrowserStorageSnapshot } from "@/lib/hooks/use-browser-storage-snapshot";
import { api, ApiError } from "@/lib/http/api-client";
import { useUrlQueryState } from "@/lib/hooks/use-url-query-state";
import { useI18n } from "@/lib/i18n/use-locale";
import { formatAge } from "@/lib/public-status/format";
import { BOARD_SORTS, BOARD_STATUS_FILTERS, DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, boardQueryToSearch, parseBoardQuery } from "@/lib/public-status/query";
import type { PublicBoardResponse } from "@/lib/public-status/types";
import { NodeCard, NodeTable, SummaryStrip, accentStyle } from "./public-board-parts";
import { usePublicPolling } from "./use-public-polling";

const VIEW_KEY = "vch.publicStatus.view";
const URL_DEFAULTS = { q: "", group: "", status: "all", sort: "default", dir: "asc", page: "1", pageSize: String(DEFAULT_PAGE_SIZE) };

class BoardClosedError extends Error {}

function readView(storage: Storage): "cards" | "table" | null {
	const value = storage.getItem(VIEW_KEY);
	return value === "cards" || value === "table" ? value : null;
}

export function PublicBoardClient({ initial, preview, signedIn }: { initial: PublicBoardResponse; preview: boolean; signedIn: boolean }) {
	const { t, locale } = useI18n();
	const fieldId = useId();
	const { state: urlState, patch } = useUrlQueryState(URL_DEFAULTS);
	const query = useMemo(() => parseBoardQuery(urlState), [urlState]);
	const search = boardQueryToSearch(query);
	const [searchText, setSearchText] = useState(query.q);
	const storedView = useBrowserStorageSnapshot(VIEW_KEY, readView, null);
	const [nowMs, setNowMs] = useState(() => Date.parse(initial.generatedAt));

	const fetcher = useCallback(
		async (signal: AbortSignal) => {
			const params = new URLSearchParams(search);
			if (preview) params.set("preview", "1");
			try {
				return await api.get<PublicBoardResponse>(`/api/status/board${params.size ? `?${params}` : ""}`, { signal, cache: "no-store" });
			} catch (error) {
				if (error instanceof ApiError && error.status === 404) throw new BoardClosedError("closed");
				throw error;
			}
		},
		[search, preview],
	);
	const polling = usePublicPolling({
		initial,
		key: search,
		intervalMs: initial.site.refreshSeconds * 1000,
		fetcher,
		initialFresh: true,
	});
	const board = polling.data;
	const site = board.site;
	const view = storedView ?? site.defaultView;

	useEffect(() => {
		const timer = setInterval(() => setNowMs(Date.now()), 5_000);
		return () => clearInterval(timer);
	}, []);
	// A 404 while viewing means the board was closed (or this preview lost its admin session).
	const closed = polling.error === "closed";
	// Debounced search → URL (resets to the first page).
	useEffect(() => {
		if (searchText.trim() === query.q) return;
		const timer = setTimeout(() => patch({ q: searchText.trim(), page: "1" }), 300);
		return () => clearTimeout(timer);
	}, [searchText, query.q, patch]);

	const setView = (next: "cards" | "table") => writeLocalStorageValue(VIEW_KEY, next);
	const filtersActive = query.q !== "" || query.group !== "" || query.status !== "all";
	const clearFilters = () => {
		setSearchText("");
		patch({ q: "", group: "", status: "all", page: "1" });
	};
	const firstIndex = board.filteredTotal === 0 ? 0 : (board.query.page - 1) * board.query.pageSize + 1;
	const lastIndex = Math.min(board.filteredTotal, board.query.page * board.query.pageSize);
	const linkSuffix = preview ? "?preview=1" : "";
	const metricSortable = (key: string) => key === "default" || key === "name" || key === "status" || site.metrics.includes(key);
	const title = site.title || t("publicStatus.defaultTitle");

	return (
		<div style={accentStyle(site.accent)} className="flex flex-col gap-5" data-public-board>
			<header className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="text-xs font-medium uppercase tracking-wide text-[var(--board-accent)]">{t("publicStatus.eyebrow")}</p>
					<h1 className="ui-title-page mt-1">{title}</h1>
					{site.description ? <p className="mt-1 max-w-3xl whitespace-pre-line text-sm text-[var(--text-secondary)]">{site.description}</p> : null}
				</div>
				<div className="flex items-center gap-2">
					<LanguageToggle compact />
					<ThemeToggle compact />
					{signedIn ? (
						<ButtonLink href="/dashboard" variant="outline" size="sm">{t("publicStatus.toDashboard")}</ButtonLink>
					) : (
						<ButtonLink href="/login?next=%2F" variant="primary" size="sm">{t("publicStatus.signIn")}</ButtonLink>
					)}
				</div>
			</header>

			{preview ? (
				<p role="note" className="rounded-lg border border-[var(--info-border)] bg-[var(--info-bg)] px-3 py-2 text-sm text-[var(--info)]">
					{t("publicStatus.previewNotice")}
				</p>
			) : null}

			{site.announcement ? (
				<section aria-label={t("publicStatus.announcement")} data-inset className="px-4 py-3">
					<p className="whitespace-pre-line text-sm text-[var(--text-primary)]">{site.announcement}</p>
				</section>
			) : null}

			{closed ? (
				<p role="alert" className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2 text-sm text-[var(--warning)]">
					{t("publicStatus.closedWhileViewing")}
				</p>
			) : polling.error ? (
				<div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2 text-sm text-[var(--warning)]">
					<span>
						{t("publicStatus.refreshFailed", { age: formatAge(new Date(polling.refreshedAt).toISOString(), nowMs, locale) })}
						{polling.nextAttemptAt ? ` ${t("publicStatus.retryIn", { seconds: Math.max(1, Math.round((polling.nextAttemptAt - nowMs) / 1000)) })}` : ""}
					</span>
					<ActionButton size="xs" variant="outline" onClick={polling.refresh} loading={polling.loading}>{t("publicStatus.retry")}</ActionButton>
				</div>
			) : null}

			{board.platform ? (
				<p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
					<span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${board.platform.overall === "healthy" ? "bg-[var(--success)]" : board.platform.overall === "warning" ? "bg-[var(--warning)]" : "bg-[var(--danger)]"}`} />
					{t("publicStatus.platform", { status: t(`publicStatus.platform.${board.platform.overall}`) })}
				</p>
			) : null}

			<SummaryStrip summary={board.summary} metrics={site.metrics} nowMs={nowMs} refreshedAt={polling.refreshedAt} locale={locale} t={t} />
			{board.summary.truncated ? (
				<p role="note" className="text-sm text-[var(--warning)]">{t("publicStatus.truncated", { count: board.summary.total })}</p>
			) : null}

			{board.summary.total === 0 ? (
				<div data-card className="p-8 text-center">
					<p className="text-base font-medium">{t("publicStatus.empty.title")}</p>
					<p className="mt-1 text-sm text-[var(--text-muted)]">{t(preview ? "publicStatus.empty.adminHint" : "publicStatus.empty.desc")}</p>
				</div>
			) : (
				<>
					<section aria-label={t("publicStatus.filters")} className="flex flex-col gap-3">
						<div className="flex flex-wrap items-end gap-2">
							<div className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-[var(--text-muted)]">
								<label htmlFor={`${fieldId}-q`}>{t("publicStatus.search")}</label>
								<input
									id={`${fieldId}-q`}
									type="search"
									className={UI_INPUT}
									value={searchText}
									maxLength={100}
									placeholder={t("publicStatus.searchPlaceholder")}
									onChange={(event) => setSearchText(event.target.value)}
								/>
							</div>
							<div className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
								<label htmlFor={`${fieldId}-status`}>{t("publicStatus.statusFilter")}</label>
								<select id={`${fieldId}-status`} className={UI_INPUT} value={query.status} onChange={(event) => patch({ status: event.target.value, page: "1" })}>
									{BOARD_STATUS_FILTERS.map((status) => (
										<option key={status} value={status}>{status === "all" ? t("publicStatus.all") : t(`publicStatus.status.${status}`)}</option>
									))}
								</select>
							</div>
							<div className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
								<label htmlFor={`${fieldId}-sort`}>{t("publicStatus.sort")}</label>
								<select id={`${fieldId}-sort`} className={UI_INPUT} value={board.query.sort} onChange={(event) => patch({ sort: event.target.value, page: "1" })}>
									{BOARD_SORTS.filter(metricSortable).map((sort) => (
										<option key={sort} value={sort}>{t(`publicStatus.sort.${sort}`)}</option>
									))}
								</select>
							</div>
							<ActionButton
								variant="outline"
								size="sm"
								aria-label={t(query.dir === "asc" ? "publicStatus.dir.asc" : "publicStatus.dir.desc")}
								onClick={() => patch({ dir: query.dir === "asc" ? "desc" : "asc", page: "1" })}
							>
								{query.dir === "asc" ? "↑" : "↓"} {t(query.dir === "asc" ? "publicStatus.dir.asc" : "publicStatus.dir.desc")}
							</ActionButton>
							<SegmentedControl
								ariaLabel={t("publicStatus.view")}
								value={view}
								onChange={setView}
								size="sm"
								options={[
									{ value: "cards", label: t("publicStatus.view.cards") },
									{ value: "table", label: t("publicStatus.view.table") },
								]}
							/>
						</div>
						{board.summary.groups.length > 0 ? (
							<div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label={t("publicStatus.groups")}>
								<ToggleChip active={query.group === ""} onClick={() => patch({ group: "", page: "1" })}>
									{t("publicStatus.allGroups", { count: board.summary.total })}
								</ToggleChip>
								{board.summary.groups.map((group) => (
									<ToggleChip key={group.name} active={query.group === group.name} onClick={() => patch({ group: group.name, page: "1" })}>
										{group.name} <span className="ml-1 text-[var(--text-muted)]">{group.online}/{group.total}</span>
									</ToggleChip>
								))}
							</div>
						) : null}
						<p className="text-xs text-[var(--text-muted)]" aria-live="polite">
							{t("publicStatus.resultCount", { from: firstIndex, to: lastIndex, filtered: board.filteredTotal, total: board.summary.total })}
							{polling.loading ? ` · ${t("publicStatus.refreshing")}` : ""}
						</p>
					</section>

					{board.filteredTotal === 0 ? (
						<div data-card className="flex flex-col items-center gap-3 p-8 text-center">
							<p className="text-sm">{t("publicStatus.noMatch")}</p>
							{filtersActive ? <ActionButton size="sm" variant="outline" onClick={clearFilters}>{t("publicStatus.clearFilters")}</ActionButton> : null}
						</div>
					) : view === "table" ? (
						<NodeTable nodes={board.nodes} nowMs={nowMs} locale={locale} t={t} metrics={site.metrics} linkSuffix={linkSuffix} />
					) : (
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
							{board.nodes.map((node) => (
								<NodeCard key={node.id} node={node} nowMs={nowMs} locale={locale} t={t} linkSuffix={linkSuffix} />
							))}
						</div>
					)}

					{board.filteredTotal > 0 ? (
						<nav aria-label={t("publicStatus.pagination")} className="flex flex-wrap items-center justify-between gap-2 text-sm">
							<div className="flex items-center gap-2">
								<ActionButton size="sm" variant="outline" disabled={board.query.page <= 1} onClick={() => patch({ page: String(board.query.page - 1) })}>
									{t("publicStatus.prev")}
								</ActionButton>
								<span className="text-[var(--text-secondary)]">{t("publicStatus.pageOf", { page: board.query.page, pages: board.totalPages })}</span>
								<ActionButton size="sm" variant="outline" disabled={board.query.page >= board.totalPages} onClick={() => patch({ page: String(board.query.page + 1) })}>
									{t("publicStatus.next")}
								</ActionButton>
							</div>
							<div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
								<label htmlFor={`${fieldId}-size`} className="whitespace-nowrap">{t("publicStatus.pageSize")}</label>
								<select id={`${fieldId}-size`} className={UI_INPUT} value={board.query.pageSize} onChange={(event) => patch({ pageSize: event.target.value, page: "1" })}>
									{PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
								</select>
							</div>
						</nav>
					) : null}
				</>
			)}
			<p className="text-center text-xs text-[var(--text-muted)]">{t("publicStatus.footer")}</p>
		</div>
	);
}

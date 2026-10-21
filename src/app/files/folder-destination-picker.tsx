"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Folder, Home } from "@/components/icons";
import { Pagination } from "@/components/pagination";
import { IconButton, InlineLoading, Notice } from "@/components/ui-primitives";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getErrorMessage } from "@/lib/http/error-message";
import { useI18n } from "@/lib/i18n/use-locale";
import type { FilesApiResponse } from "./files-browser-helpers";

type FolderPage = Pick<FilesApiResponse, "folders" | "pagination" | "syncWarning">;

/**
 * Browse one storage node's folders to pick a destination (move / copy).
 * The caller owns the current path, so the dialog's confirm button always
 * acts on the folder that is on screen. Only the first page syncs the remote
 * directory; later pages read the index (`sync=0`).
 */
export function FolderBrowser({ nodeId, nodeName, path, onPathChange, disabledPaths, onReadyChange }: {
	nodeId: string;
	/** Shown as the root of the location bar. */
	nodeName?: string;
	path: string;
	onPathChange: (path: string) => void;
	/** Folders that cannot be a destination (the folders being moved). */
	disabledPaths?: ReadonlySet<string>;
	/** True once the listing of `path` loaded, false while loading or failed. */
	onReadyChange?: (ready: boolean) => void;
}) {
	const { t } = useI18n();
	const [page, setPage] = useState(1);
	const [retry, setRetry] = useState(0);
	const [state, setState] = useState<{ key: string; data: FolderPage | null; error: string }>({ key: "", data: null, error: "" });
	const loadError = t("filesBrowserSpa.fileListRefreshFailed");
	const requestKey = `${nodeId}\u0000${path}\u0000${page}\u0000${retry}`;
	const loading = state.key !== requestKey;
	const data = loading ? null : state.data;
	const error = loading ? "" : state.error;

	useEffect(() => {
		const controller = new AbortController();
		const params = new URLSearchParams({ nodeId, page: String(page), pageSize: "50" });
		if (path) params.set("path", path);
		if (page > 1) params.set("sync", "0");
		void csrfFetch<FolderPage>(`/api/files/list?${params}`, { signal: controller.signal }).then((response) => {
			if (!controller.signal.aborted) setState({ key: requestKey, data: response, error: "" });
		}).catch((cause: unknown) => {
			if (!controller.signal.aborted) setState({ key: requestKey, data: null, error: getErrorMessage(cause, loadError) });
		});
		return () => controller.abort();
	}, [nodeId, path, page, requestKey, loadError]);

	useEffect(() => {
		onReadyChange?.(!loading && !error && data !== null);
	}, [loading, error, data, onReadyChange]);

	const navigate = (next: string) => {
		setPage(1);
		onPathChange(next);
	};
	const segments = path ? path.split("/") : [];

	return (
		<div className="flex flex-col gap-3">
			<nav aria-label={t("filesBrowserSpa.breadcrumbAria")} className="flex min-w-0 items-center gap-1 text-sm">
				<IconButton label={t("fileListClient.upLevel")} disabled={!path || loading}
					onClick={() => navigate(segments.slice(0, -1).join("/"))}>
					<ChevronRight size={18} className="-rotate-90" aria-hidden />
				</IconButton>
				<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
					<button type="button" onClick={() => navigate("")} disabled={!path}
						className="inline-flex max-w-[12rem] items-center gap-1.5 truncate rounded-md px-1.5 py-1 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:text-[var(--text-primary)]">
						<Home size={14} aria-hidden />
						<span className="truncate">{nodeName ?? t("filesBrowserSpa.allFiles")}</span>
					</button>
					{segments.map((segment, index) => {
						const target = segments.slice(0, index + 1).join("/");
						const last = index === segments.length - 1;
						return (
							<span key={target} className="flex min-w-0 items-center gap-1">
								<ChevronRight size={14} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
								<button type="button" onClick={() => navigate(target)} disabled={last} aria-current={last ? "location" : undefined}
									className="max-w-[10rem] truncate rounded-md px-1.5 py-1 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:font-medium disabled:text-[var(--text-primary)]">
									{segment}
								</button>
							</span>
						);
					})}
				</div>
			</nav>
			{error ? <Notice tone="danger" action={{ label: t("common.retry"), onClick: () => setRetry((value) => value + 1) }}>{error}</Notice> : null}
			{data?.syncWarning ? <Notice tone="warning">{data.syncWarning}</Notice> : null}
			<div data-inset aria-busy={loading} className="max-h-72 min-h-40 overflow-y-auto">
				{loading ? <InlineLoading label={t("common.loading")} className="p-3" /> : !error && data?.folders.length === 0 ?
					<p className="p-3 text-sm text-[var(--text-muted)]">{t("filesPage.move.noFoldersOnPage")}</p> : null}
				{!loading && !error ? data?.folders.map((folder) => {
					const target = folder.relativePath ?? folder.path;
					const blocked = disabledPaths?.has(target) ?? false;
					return (
						<button key={folder.path} type="button" disabled={blocked}
							className="flex min-h-11 w-full items-center gap-2.5 border-b border-[var(--border-subtle)] px-3 text-left text-sm last:border-b-0 hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
							onClick={() => navigate(target)}>
							<Folder size={18} className="shrink-0 text-[var(--chart-3)]" aria-hidden />
							<span className="min-w-0 flex-1 break-all">{folder.displayName ?? folder.name}</span>
							<ChevronRight size={16} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
						</button>
					);
				}) : null}
			</div>
			{data?.pagination && data.pagination.totalItems > data.pagination.pageSize ? (
				<Pagination {...data.pagination} loading={loading} onPageChange={(next) => setPage(next)} />
			) : null}
		</div>
	);
}

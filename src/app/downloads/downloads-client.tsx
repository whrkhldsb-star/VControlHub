"use client";

import { useState, useEffect, useCallback, useRef, type MouseEvent } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { EmptyState, ListPanel, SurfacePanel, Toolbar } from "@/components/page-shell";
import { Download, Plus } from "@/components/icons";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useVisibilityInterval } from "@/lib/hooks/use-visibility-interval";
import { useUrlQueryState } from "@/lib/hooks/use-url-query-state";
import { CreateDownloadFormLazy } from "./create-download-form-lazy";
import { DownloadTaskRow } from "./downloads-task-row";
import { getCategories, getErrorMessage, getStatusLabel, formatSpeed, type DownloadTask, type GlobalStat, type ServerOption } from "./downloads-shared";
import { ActionButton, ButtonLink } from "@/components/action-button";
import { Chip, InlineLoading, Notice } from "@/components/ui-primitives";
export type { ServerOption } from "./downloads-shared";
const UNCATEGORIZED_FILTER = "__uncategorized";

export function DownloadsClient({ servers, canManage, canManageNode }: { servers: ServerOption[]; canManage: boolean; canManageNode: boolean }) {
	const { t, locale } = useI18n();
	const { addToast } = useToast();

	const [tasks, setTasks] = useState<DownloadTask[]>([]);
	const [globalStat, setGlobalStat] = useState<GlobalStat>(null);
	const [loading, setLoading] = useState(true);
	const [loadFailed, setLoadFailed] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [showForm, setShowForm] = useState(false);
	const { state: urlFilters, setField: setUrlFilter } = useUrlQueryState({
		status: "ALL",
		// Default "all" means no category filter. Empty string is reserved for the
		// uncategorized chip (tasks with null/empty category) so it can round-trip
		// through the URL without collapsing to "no filter".
		category: "all",
	});
	const filter = urlFilters.status || "ALL";
	const categoryFilter =
		urlFilters.category === "all"
			? null
			: urlFilters.category === UNCATEGORIZED_FILTER
				? ""
				: urlFilters.category;
	const setFilter = (value: string) => setUrlFilter("status", value);
	const setCategoryFilter = (value: string | null) =>
		setUrlFilter(
			"category",
			value === null ? "all" : value || UNCATEGORIZED_FILTER,
		);

	const defaultServer = servers[0];
	const defaultTargetPath = defaultServer?.storagePath ?? "/root/downloads";
	const [form, setForm] = useState({
		url: "", serverId: defaultServer?.id ?? "", targetPath: defaultTargetPath,
		fileName: "", category: "", maxSpeedKb: "", batchMode: false, batchText: "",
	});
	const [submitting, setSubmitting] = useState(false);
	const [busyActions, setBusyActions] = useState<Record<string, string>>({});
	const busyActionRef = useRef<Set<string>>(new Set());
	const [downloadingIds, setDownloadingIds] = useState<Record<string, boolean>>({});
	const [pendingPurgeTaskId, setPendingPurgeTaskId] = useState<string | null>(null);

	const nextCursorRef = useRef<string | null>(null);
	const loadedFilterKeyRef = useRef("");
	const currentFilterKeyRef = useRef("");
	const loadedPageCountRef = useRef(1);
	const requestInFlightRef = useRef<"refresh" | "more" | null>(null);
	const pendingRefreshRef = useRef(false);
	const pendingPageFilterRef = useRef<string | null>(null);
	const listControllerRef = useRef<AbortController | null>(null);
	const mountedRef = useRef(true);
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			listControllerRef.current?.abort();
		};
	}, []);
	const filterKey = `${filter}:${categoryFilter ?? "all"}`;
	useEffect(() => {
		if (currentFilterKeyRef.current !== filterKey) {
			pendingPageFilterRef.current = null;
			listControllerRef.current?.abort();
		}
		currentFilterKeyRef.current = filterKey;
	}, [filterKey]);

	const fetchTasks = useCallback(async (loadMore = false): Promise<void> => {
		// Serialize paging and polling so a slow page cannot overwrite a refresh.
		if (requestInFlightRef.current) {
			if (!loadMore) pendingRefreshRef.current = true;
			else if (requestInFlightRef.current === "refresh" && loadedFilterKeyRef.current === filterKey) {
				pendingPageFilterRef.current = filterKey;
			}
			return;
		}
		if (loadMore && (!nextCursorRef.current || loadedFilterKeyRef.current !== filterKey)) return;
		requestInFlightRef.current = loadMore ? "more" : "refresh";
		if (!loadMore) pendingRefreshRef.current = false;
		const controller = new AbortController();
		listControllerRef.current = controller;
		const requestFilterKey = filterKey;
		const isCurrent = () => mountedRef.current && requestFilterKey === currentFilterKeyRef.current;
		if (!loadMore && loadedFilterKeyRef.current !== filterKey) {
			loadedPageCountRef.current = 1;
			nextCursorRef.current = null;
			setNextCursor(null);
			setLoading(true);
		}
		setLoadFailed(false);
		if (loadMore) setLoadingMore(true);
		try {
			const incoming = new Map<string, DownloadTask>();
			let cursor = loadMore ? nextCursorRef.current : null;
			const pagesToFetch = loadMore ? 1 : loadedPageCountRef.current;
			let pagesFetched = 0;
			let latestGlobalStat: GlobalStat = null;
			for (let page = 0; page < pagesToFetch; page++) {
				const params = new URLSearchParams();
				if (filter !== "ALL") params.set("status", filter);
				if (categoryFilter !== null) params.set("category", categoryFilter || UNCATEGORIZED_FILTER);
				if (cursor) params.set("cursor", cursor);
				const query = params.toString();
				const data = await csrfFetch<{ tasks: DownloadTask[]; nextCursor: string | null; globalStat: GlobalStat }>(
					`/api/downloads${query ? `?${query}` : ""}`, { signal: controller.signal },
				);
				if (!isCurrent()) return;
				for (const task of data.tasks) incoming.set(task.id, task);
				cursor = data.nextCursor ?? null;
				latestGlobalStat = data.globalStat ?? null;
				pagesFetched++;
				if (!cursor) break;
			}
			setTasks((current) => {
				if (!loadMore) return [...incoming.values()];
				const merged = new Map(current.map((task) => [task.id, task]));
				for (const [id, task] of incoming) merged.set(id, task);
				return [...merged.values()];
			});
			loadedFilterKeyRef.current = filterKey;
			loadedPageCountRef.current = loadMore ? loadedPageCountRef.current + pagesFetched : pagesFetched;
			nextCursorRef.current = cursor;
			if (!cursor) pendingPageFilterRef.current = null;
			setNextCursor(cursor);
			setGlobalStat(latestGlobalStat);
		} catch (error) {
			if (isCurrent() && !controller.signal.aborted) {
				setLoadFailed(true);
				addToast("error", getErrorMessage(error, t("downloadsPage.error.loadList")));
			}
		} finally {
			requestInFlightRef.current = null;
			if (isCurrent()) {
				setLoading(false);
				setLoadingMore(false);
			}
			if (mountedRef.current && pendingPageFilterRef.current === currentFilterKeyRef.current) {
				pendingPageFilterRef.current = null;
				void fetchTasksRef.current(true);
			} else if (mountedRef.current && pendingRefreshRef.current) void fetchTasksRef.current();
		}
	}, [t, addToast, categoryFilter, filter, filterKey]);

	const fetchTasksRef = useRef(fetchTasks);
	const tasksRef = useRef(tasks);

	useEffect(() => {
		fetchTasksRef.current = fetchTasks;
		tasksRef.current = tasks;
	}, [fetchTasks, tasks]);

	useEffect(() => {
		const timer = window.setTimeout(() => { void fetchTasks(); }, 0);
		return () => window.clearTimeout(timer);
	}, [fetchTasks]);

	useVisibilityInterval(() => {
			const hasRunning = tasksRef.current.some((t) => t.status === "RUNNING" || t.status === "PENDING");
			if (hasRunning) {
				void fetchTasksRef.current();
			}
	}, 5000);

	const invalidBatchUrls = form.batchMode
		? form.batchText.split("\n").map((l) => l.trim()).filter(Boolean)
		: [];
	const hasBatchMagnet = invalidBatchUrls.some((line) => line.startsWith("magnet:?") || line.endsWith(".torrent"));
	const hasBatchHttp = invalidBatchUrls.some((line) => line.startsWith("http://") || line.startsWith("https://"));
	const batchModeError = form.batchMode && invalidBatchUrls.length > 1 && hasBatchMagnet && hasBatchHttp
		? t("downloadsPage.error.magnetBatchNotice")
		: null;

	const handleServerChange = (serverId: string) => {
		const srv = servers.find((s) => s.id === serverId);
		setForm((p) => ({ ...p, serverId, targetPath: srv?.storagePath ?? "/root/downloads" }));
	};

	const handleSubmit = async () => {
		if (!form.serverId) {
			addToast("error", t("downloadsPage.error.noVps") );
			return;
		}
		if (batchModeError) {
			addToast("error", batchModeError );
			return;
		}
		const isBatch = form.batchMode;
		const batchUrls = isBatch
			? form.batchText.split("\n").map((l) => l.trim()).filter(Boolean)
			: undefined;
		if (isBatch) {
			if (!batchUrls || batchUrls.length === 0) {
				addToast("error", t("downloadsPage.error.emptyBatch"));
				return;
			}
		} else if (!form.url.trim()) {
			addToast("error", t("downloadsPage.error.emptyUrl"));
			return;
		}
		const trimmedFileName = form.fileName.trim();
		if (trimmedFileName && (trimmedFileName.includes("/") || trimmedFileName.includes("\\") || trimmedFileName.includes(".."))) {
			addToast("error", t("downloadsPage.error.invalidFilename") );
			return;
		}
		setSubmitting(true);
		try {
			const payload: Record<string, unknown> = {
				url: isBatch ? batchUrls?.[0] ?? "" : form.url,
				serverId: form.serverId, targetPath: form.targetPath,
				fileName: form.fileName || undefined, category: form.category || undefined,
				maxSpeedKb: form.maxSpeedKb ? parseInt(form.maxSpeedKb, 10) : undefined,
				isBatch, batchUrls,
			};
			await csrfFetch("/api/downloads", {
				method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
			});
			addToast("success", isBatch ? `${t("downloadsPage.success.batchCreated", { count: batchUrls?.length ?? 0 })}` : t("downloadsPage.success.taskCreated"));
			setForm({ url: "", serverId: servers[0]?.id ?? "", targetPath: defaultTargetPath, fileName: "", category: "", maxSpeedKb: "", batchMode: false, batchText: "" });
			setShowForm(false); fetchTasks();
		} catch (error) { addToast("error", getErrorMessage(error, t("downloadsPage.error.taskCreate")) ); }
		finally { setSubmitting(false); }
	};

	const handleAction = async (taskId: string, action: string) => {
		const busyKey = `${taskId}:${action.startsWith("limit:") ? "limit" : action}`;
		if (busyActionRef.current.has(busyKey)) return;
		busyActionRef.current.add(busyKey);
		setBusyActions((current) => ({ ...current, [busyKey]: action }));
		try {
			if (action === "cancel") {
				await csrfFetch(`/api/downloads?taskId=${taskId}`, { method: "DELETE" });
				addToast("success", t("downloadsPage.success.cancelled") );
				void fetchTasks();
			} else if (action === "purge") {
				await csrfFetch(`/api/downloads?taskId=${taskId}&purge=1`, { method: "DELETE" });
				setTasks((current) => current.filter((task) => task.id !== taskId));
				setPendingPurgeTaskId(null);
				addToast("success", t("downloadsPage.success.deleted") );
				void fetchTasks();
			} else if (action === "retry") {
				const task = tasks.find((t) => t.id === taskId);
				if (!task) {
					addToast("error", t("downloadsPage.error.notFound") );
					return;
				}
				const payload: Record<string, unknown> = {
					url: task.url,
					serverId: task.serverId,
					targetPath: task.targetPath,
					...(task.fileName ? { fileName: task.fileName } : {}),
					...(task.category ? { category: task.category } : {}),
					...(task.maxSpeedKb ? { maxSpeedKb: task.maxSpeedKb } : {}),
				};
				await csrfFetch("/api/downloads", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				});
				addToast("success", t("downloadsPage.success.recreated") );
				void fetchTasks();
			} else if (action.startsWith("limit:")) {
				const maxSpeedKb = parseInt(action.slice(6));
				await csrfFetch("/api/downloads", {
					method: "PATCH", headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ taskId, maxSpeedKb }),
				});
				addToast("success", t("downloadsPage.success.speedSet", { kb: maxSpeedKb }));
				void fetchTasks();
			} else {
				const result = await csrfFetch("/api/downloads", {
					method: "PATCH", headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ taskId, action }),
				});
				if (action === "refresh" && result?.status) {
					setTasks((current) => current.map((task) => task.id === taskId ? {
						...task,
						status: result.status ?? task.status,
						progress: result.progress ?? task.progress,
						completedBytes: result.completedBytes ?? task.completedBytes,
						totalBytes: result.totalBytes ?? task.totalBytes,
						downloadSpeed: result.downloadSpeed ?? task.downloadSpeed,
						fileSize: result.fileSize ?? task.fileSize,
						downloadAccess: result.downloadAccess ?? task.downloadAccess,
						errorMessage: result.errorMessage ?? task.errorMessage,
					} : task));
				} else {
					void fetchTasks();
				}
			}
		} catch (error) {
			addToast("error", getErrorMessage(error, t("downloadsPage.error.taskOp")) );
		} finally {
			busyActionRef.current.delete(busyKey);
			setBusyActions((current) => {
				const next = { ...current };
				delete next[busyKey];
				return next;
			});
		}
	};

	const handleGlobalSpeedLimit = async (kb: number) => {
		try {
			await csrfFetch("/api/downloads", {
				method: "PATCH", headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ globalMaxSpeedKb: kb }),
			});
			addToast("success", kb === 0 ? t("downloadsPage.success.globalSpeedCleared") : t("downloadsPage.success.globalSpeedSet", { kb }));
		} catch (error) {
			addToast("error", getErrorMessage(error, t("downloadsPage.error.globalSpeed")) );
		}
	};

	const categories = getCategories(t);
	const handleDownloadClick = (taskId: string) => (event: MouseEvent<HTMLAnchorElement>) => {
		if (downloadingIds[taskId]) {
			event.preventDefault();
			return;
		}
		setDownloadingIds((current) => ({ ...current, [taskId]: true }));
		window.setTimeout(() => {
			setDownloadingIds((current) => {
				const next = { ...current };
				delete next[taskId];
				return next;
			});
		}, 4000);
	};

	const filteredTasks = tasks
		.filter((t) => filter === "ALL" || t.status === filter)
		.filter((t) => categoryFilter === null || (t.category ?? "") === categoryFilter);

	const runningCount = tasks.filter((t) => t.status === "RUNNING").length;
	const pendingCount = tasks.filter((t) => t.status === "PENDING").length;
	const pendingPurgeTask = pendingPurgeTaskId ? tasks.find((task) => task.id === pendingPurgeTaskId) : null;
	const pendingPurgeName = pendingPurgeTask?.fileName || pendingPurgeTask?.url || pendingPurgeTaskId || "";

	return (
		<div>

			{globalStat && (
				<SurfacePanel className="mb-5" title={t("downloadsPage.stats.globalSpeed")}>
				<div className="flex flex-wrap items-center gap-5 text-sm">
					<div>
						<span className="text-[var(--text-muted)]">{t("downloadsPage.stats.globalSpeed")}</span>
						<span className="ml-2 font-mono font-semibold text-[var(--accent)]">{formatSpeed(globalStat.downloadSpeed)}</span>
					</div>
					<div>
						<span className="text-[var(--text-muted)]">{t("downloadsPage.stats.active")}</span>
						<span className="ml-2 font-medium text-[var(--text-primary)]">{globalStat.numActive}</span>
					</div>
					<div>
						<span className="text-[var(--text-muted)]">{t("downloadsPage.stats.pending")}</span>
						<span className="ml-2 text-[var(--warning)]">{globalStat.numWaiting}</span>
					</div>
					<div className="ml-auto flex flex-wrap items-center gap-2">
						<span className="text-xs text-[var(--text-muted)]">{t("downloadsPage.stats.globalLimit")}</span>
						{canManageNode ? [0, 1024, 5120, 10240].map((kb) => (
							<Chip key={kb} onClick={() => handleGlobalSpeedLimit(kb)}>
								{kb === 0 ? t("downloadsPage.stats.unlimited") : `${kb >= 1024 ? (kb / 1024) + "M" : kb + "K"}`}
							</Chip>
						)) : <span className="text-xs text-[var(--text-muted)]">{t("downloadsPage.stats.needPermission")}</span>}
					</div>
				</div>
				</SurfacePanel>
			)}

			{/* Quick Stats */}
			{!globalStat && (runningCount > 0 || pendingCount > 0) && (
				<div className="mb-4 flex gap-3 text-xs text-[var(--text-muted)]">
					{runningCount > 0 && <span className="text-[var(--accent)]">{t("downloadsPage.stats.runningCount", { count: runningCount })}</span>}
					{pendingCount > 0 && <span className="text-[var(--warning)]">{t("downloadsPage.stats.pendingCount", { count: pendingCount })}</span>}
				</div>
			)}

			<Toolbar className="mb-5 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-wrap items-center gap-2">
					{["ALL", "PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"].map((f) => (
						<Chip key={f} selected={filter === f} onClick={() => setFilter(f)}>
							{f === "ALL" ? t("downloadsPage.filter.all") : getStatusLabel(t)[f]}
						</Chip>
					))}
					<div className="h-4 w-px bg-[var(--border)]" />
					{categories.map((c) => (
						<Chip key={c.value} selected={categoryFilter === c.value} onClick={() => setCategoryFilter(categoryFilter === c.value ? null : c.value)}>
							{c.label}
						</Chip>
					))}
				</div>
				{canManage && servers.length > 0 ? (
					<ActionButton
						variant={showForm ? "secondary" : "primary"}
						icon={showForm ? undefined : <Plus size={16} aria-hidden />}
						onClick={() => setShowForm(!showForm)}
					>
						{showForm ? t("downloadsPage.form.cancelLabel") : t("downloadsPage.form.createLabel")}
					</ActionButton>
				) : canManage ? (
					<Notice tone="warning" compact>
						<span className="flex flex-wrap items-center gap-2">
							{t("downloadsPage.form.noTarget")}
							<ButtonLink href="/servers" size="xs" variant="secondary">{t("downloadsPage.form.noTargetAction")}</ButtonLink>
						</span>
					</Notice>
				) : null}
			</Toolbar>

			{/* Create form — TR-036 lazy chunk, only fetched on first open */}
			<CreateDownloadFormLazy
				open={showForm && canManage}
				form={form}
				submitting={submitting}
				batchModeError={batchModeError}
				servers={servers}
				selectedServerId={form.serverId}
				onFormChange={setForm}
				onServerChange={handleServerChange}
				onSubmit={handleSubmit}
			/>

			<ListPanel
				title={t("downloadsPage.header.title")}
				count={loading ? "…" : filteredTasks.length}
				empty={
					loading ? (
						<InlineLoading label={t("downloadsPage.loading")} />
					) : filteredTasks.length === 0 && !loadFailed ? (
						<EmptyState icon={<Download size={24} className="text-[var(--text-muted)]" />}>
							{filter === "ALL"
								? t("downloadsPage.empty")
								: t("downloadsPage.emptyFilter", { status: getStatusLabel(t)[filter] ?? "" })}
						</EmptyState>
					) : undefined
				}
				bodyClassName="!divide-y-0 space-y-0 bg-transparent p-2.5"
			>
				{!loading && filteredTasks.map((task) => (
					<div key={task.id} className="mb-2.5 last:mb-0">
						<DownloadTaskRow
							task={task}
							t={t}
							locale={locale}
							canManage={canManage}
							busyActions={busyActions}
							downloadingIds={downloadingIds}
							onAction={handleAction}
							onDownloadClick={handleDownloadClick}
							onPendingPurge={setPendingPurgeTaskId}
						/>
					</div>
				))}
        {!loading && nextCursor ? (
			<div className="flex justify-center border-t border-[var(--border)] px-4 py-3">
            <ActionButton
              type="button"
              variant="secondary"
              disabled={loadingMore}
              onClick={() => void fetchTasks(true)}>
              {loadingMore
                ? t("downloadsPage.loadingMore")
                : t("downloadsPage.loadMore")}
            </ActionButton>
          </div>
        ) : null}
      </ListPanel>
			<ConfirmDialog
				open={pendingPurgeTaskId !== null}
				title={t("common.confirmDelete")}
				description={t("downloadsPage.confirm.purge", { name: pendingPurgeName })}
				cancelLabel={t("common.cancel")}
				confirmLabel={t("common.confirmDelete")}
				busy={pendingPurgeTaskId ? Boolean(busyActions[`${pendingPurgeTaskId}:purge`]) : false}
				onCancel={() => setPendingPurgeTaskId(null)}
				onConfirm={() => { if (pendingPurgeTaskId) void handleAction(pendingPurgeTaskId, "purge"); }}
			/>
		</div>
	);
}

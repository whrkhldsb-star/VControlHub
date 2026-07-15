"use client";

import { useState, useEffect, useCallback, useRef, type MouseEvent } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { EmptyState, ListPanel, SurfacePanel, Toolbar } from "@/components/page-shell";
import { Download } from "@/components/icons";
import { useI18n } from "@/lib/i18n/use-locale";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";
import { useVisibilityInterval } from "@/lib/hooks/use-visibility-interval";
import { CreateDownloadFormLazy } from "./create-download-form-lazy";
import { DownloadTaskRow } from "./downloads-task-row";
import { getCategories, getErrorMessage, getStatusLabel, formatSpeed, type DownloadTask, type GlobalStat, type ServerOption } from "./downloads-shared";
export type { ServerOption } from "./downloads-shared";
export function DownloadsClient({ servers, canManage, canManageNode }: { servers: ServerOption[]; canManage: boolean; canManageNode: boolean }) {
	const { t } = useI18n();

	const [tasks, setTasks] = useState<DownloadTask[]>([]);
	const [globalStat, setGlobalStat] = useState<GlobalStat>(null);
	const [loading, setLoading] = useState(true);
	const [showForm, setShowForm] = useState(false);
	const [filter, setFilter] = useState("ALL");
	const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
	const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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
  const dialogRef = useDialogFocus<HTMLDivElement>({ open: pendingPurgeTaskId !== null, onClose: () => setPendingPurgeTaskId(null) });

	const fetchTasks = useCallback(async () => {
		try {
			const data = await csrfFetch("/api/downloads");
			setTasks(data.tasks ?? data);
			setGlobalStat(data.globalStat ?? null);
			setMessage((current) => current?.type === "error" ? null : current);
		} catch (error) {
			setMessage({ type: "error", text: getErrorMessage(error, t("downloadsPage.error.loadList")) });
		} finally { setLoading(false); }
	}, [t]);

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
			setMessage({ type: "error", text: t("downloadsPage.error.noVps") });
			return;
		}
		if (batchModeError) {
			setMessage({ type: "error", text: batchModeError });
			return;
		}
		const trimmedFileName = form.fileName.trim();
		if (trimmedFileName && (trimmedFileName.includes("/") || trimmedFileName.includes("\\") || trimmedFileName.includes(".."))) {
			setMessage({ type: "error", text: t("downloadsPage.error.invalidFilename") });
			return;
		}
		setSubmitting(true); setMessage(null);
		try {
			const isBatch = form.batchMode;
			const batchUrls = isBatch ? form.batchText.split("\n").map((l) => l.trim()).filter(Boolean) : undefined;
			const payload: Record<string, unknown> = {
				url: isBatch ? batchUrls?.[0] ?? "" : form.url,
				serverId: form.serverId, targetPath: form.targetPath,
				fileName: form.fileName || undefined, category: form.category || undefined,
				maxSpeedKb: form.maxSpeedKb ? parseInt(form.maxSpeedKb, 10) : undefined,
				isBatch, batchUrls,
			};
			const _data = await csrfFetch("/api/downloads", {
				method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
			});
			setMessage({ type: "success", text: isBatch ? `${t("downloadsPage.success.batchCreated").replace("${count}", String(batchUrls?.length ?? 0))}` : t("downloadsPage.success.taskCreated") });
			setForm({ url: "", serverId: servers[0]?.id ?? "", targetPath: defaultTargetPath, fileName: "", category: "", maxSpeedKb: "", batchMode: false, batchText: "" });
			setShowForm(false); fetchTasks();
		} catch (error) { setMessage({ type: "error", text: getErrorMessage(error, t("downloadsPage.error.taskCreate")) }); }
		finally { setSubmitting(false); }
	};

	const handleAction = async (taskId: string, action: string) => {
		const busyKey = `${taskId}:${action.startsWith("limit:") ? "limit" : action}`;
		if (busyActionRef.current.has(busyKey)) return;
		busyActionRef.current.add(busyKey);
		setBusyActions((current) => ({ ...current, [busyKey]: action }));
		setMessage(null);
		try {
			if (action === "cancel") {
				await csrfFetch(`/api/downloads?taskId=${taskId}`, { method: "DELETE" });
				setMessage({ type: "success", text: t("downloadsPage.success.cancelled") });
				void fetchTasks();
			} else if (action === "purge") {
				await csrfFetch(`/api/downloads?taskId=${taskId}&purge=1`, { method: "DELETE" });
				setTasks((current) => current.filter((task) => task.id !== taskId));
				setPendingPurgeTaskId(null);
				setMessage({ type: "success", text: t("downloadsPage.success.deleted") });
			} else if (action === "retry") {
				const task = tasks.find((t) => t.id === taskId);
				if (!task) {
					setMessage({ type: "error", text: t("downloadsPage.error.notFound") });
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
				setMessage({ type: "success", text: t("downloadsPage.success.recreated") });
				void fetchTasks();
			} else if (action.startsWith("limit:")) {
				const maxSpeedKb = parseInt(action.slice(6));
				await csrfFetch("/api/downloads", {
					method: "PATCH", headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ taskId, maxSpeedKb }),
				});
				setMessage({ type: "success", text: t("downloadsPage.success.speedSet").replace("${kb}", String(maxSpeedKb)) });
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
			setMessage({ type: "error", text: getErrorMessage(error, t("downloadsPage.error.taskOp")) });
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
		setMessage(null);
		try {
			await csrfFetch("/api/downloads", {
				method: "PATCH", headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ globalMaxSpeedKb: kb }),
			});
			setMessage({ type: "success", text: kb === 0 ? t("downloadsPage.success.globalSpeedCleared") : t("downloadsPage.success.globalSpeedSet").replace("${kb}", String(kb)) });
		} catch (error) {
			setMessage({ type: "error", text: getErrorMessage(error, t("downloadsPage.error.globalSpeed")) });
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
		.filter((t) => !categoryFilter || (t.category ?? "") === categoryFilter);

	const runningCount = tasks.filter((t) => t.status === "RUNNING").length;
	const pendingCount = tasks.filter((t) => t.status === "PENDING").length;
	const pendingPurgeTask = pendingPurgeTaskId ? tasks.find((task) => task.id === pendingPurgeTaskId) : null;
	const pendingPurgeName = pendingPurgeTask?.fileName || pendingPurgeTask?.url || pendingPurgeTaskId || "";

	return (
		<div>
			{message && (
				<div role={message.type === "error" ? "alert" : "status"} className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${
					message.type === "success" ? "border-[var(--success-border)] bg-[var(--success-bg)]/50 text-[var(--success)]" : "border-[var(--danger-border)] bg-[var(--danger-bg)]/50 text-[var(--danger)]"
				}`}>
					{message.text}
					<button type="button" onClick={() => setMessage(null)} aria-label={t("common.close")} className="ml-3 text-current/50 hover:text-current">✕</button>
				</div>
			)}

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
							<button type="button" key={kb} onClick={() => handleGlobalSpeedLimit(kb)}
								className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1 text-[11px] text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
							>
								{kb === 0 ? t("downloadsPage.stats.unlimited") : `${kb >= 1024 ? (kb / 1024) + "M" : kb + "K"}`}
							</button>
						)) : <span className="text-xs text-[var(--text-muted)]">{t("downloadsPage.stats.needPermission")}</span>}
					</div>
				</div>
				</SurfacePanel>
			)}

			{/* Quick Stats */}
			{!globalStat && (runningCount > 0 || pendingCount > 0) && (
				<div className="mb-4 flex gap-3 text-xs text-[var(--text-muted)]">
					{runningCount > 0 && <span className="text-[var(--accent)]">{t("downloadsPage.stats.runningCount").replace("${count}", String(runningCount))}</span>}
					{pendingCount > 0 && <span className="text-[var(--warning)]">{t("downloadsPage.stats.pendingCount").replace("${count}", String(pendingCount))}</span>}
				</div>
			)}

			<Toolbar className="mb-5 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-wrap items-center gap-2">
					{["ALL", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"].map((f) => (
						<button key={f} type="button" onClick={() => setFilter(f)}
							className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
								filter === f ? "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--text-primary)]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
							}`}
						>
							{f === "ALL" ? t("downloadsPage.filter.all") : getStatusLabel(t)[f]}
						</button>
					))}
					<div className="h-4 w-px bg-[var(--border)]" />
					{categories.map((c) => (
						<button key={c.value} type="button" onClick={() => setCategoryFilter(categoryFilter === c.value ? null : c.value)}
							className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
								categoryFilter === c.value ? "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--text-primary)]" : "border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
							}`}
						>
							{c.icon} {c.label}
						</button>
					))}
				</div>
				{canManage && servers.length > 0 ? (
					<button type="button" onClick={() => setShowForm(!showForm)}
						data-primary
						data-action-button data-variant="primary" className="px-5 py-2 text-sm"
					>
						{showForm ? t("downloadsPage.form.cancelLabel") : t("downloadsPage.form.createLabel")}
					</button>
				) : canManage ? (
					<div className="rounded-2xl border border-[var(--warning-border)] bg-[var(--warning-bg)] px-4 py-2 text-xs text-[var(--warning)]">
						{t("downloadsPage.form.noTarget")}
					</div>
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
						<EmptyState>{t("downloadsPage.loading")}</EmptyState>
					) : filteredTasks.length === 0 && message?.type !== "error" ? (
						<EmptyState variant="boxed" icon={<Download size={32} className="text-[var(--text-muted)]" />}>
							{filter === "ALL"
								? t("downloadsPage.empty")
								: t("downloadsPage.emptyFilter").replace("${status}", getStatusLabel(t)[filter] ?? "")}
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
							canManage={canManage}
							busyActions={busyActions}
							downloadingIds={downloadingIds}
							onAction={handleAction}
							onDownloadClick={handleDownloadClick}
							onPendingPurge={setPendingPurgeTaskId}
						/>
					</div>
				))}
			</ListPanel>
			{pendingPurgeTaskId ? (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] px-4 backdrop-blur-sm" role="presentation" onClick={() => setPendingPurgeTaskId(null)}>
					<section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="download-purge-title" onClick={(event) => event.stopPropagation()} className="w-full max-w-md rounded-2xl border border-[var(--danger-border)] bg-[var(--modal-bg)] p-6 shadow-[0_24px_100px_rgba(244,63,94,0.16)]">
						<h3 id="download-purge-title" className="text-lg font-semibold text-[var(--text-primary)]">{t("common.confirmDelete")}</h3>
						<p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{t("downloadsPage.confirm.purge").replace("${name}", pendingPurgeName)}</p>
						<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
							<button type="button" onClick={() => setPendingPurgeTaskId(null)} className="min-h-11 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">{t("common.cancel")}</button>
							<button type="button" onClick={() => handleAction(pendingPurgeTaskId, "purge")} className="min-h-11 rounded-xl bg-[var(--danger-bg)] px-4 py-2 text-sm font-semibold text-[var(--danger)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]">{t("common.confirmDelete")}</button>
						</div>
					</section>
				</div>
			) : null}
		</div>
	);
}

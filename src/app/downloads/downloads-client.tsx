"use client";

import { useState, useEffect, useCallback } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { EmptyState } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";
import { CreateDownloadFormLazy } from "./create-download-form-lazy";

/* ── Types ────────────────────────────────────────────────── */

export type ServerOption = {
	id: string;
	name: string;
	host: string;
	storagePath: string;
	storageDriver: "LOCAL" | "SFTP";
	directAccessMode: "PROXY" | "DIRECT" | "AUTO";
	directAccessAvailable: boolean;
	accessTransport: "direct" | "relay";
	accessStatusLabel: string;
	accessDescription: string;
};

type DownloadTask = {
	id: string; url: string; serverId: string; targetPath: string; fileName: string | null;
	status: string; progress: string | null; pid: number | null; errorMessage: string | null;
	relayMode: boolean | null; createdAt: string; updatedAt: string;
	aria2Gid: string | null; category: string | null; maxSpeedKb: number | null;
	totalBytes: string | null; completedBytes: string | null; downloadSpeed: string | null;
	fileSize: string | null; isBatch: boolean; batchUrls: string | null;
	downloadAccess: { mode: string; transport: "direct" | "relay"; href: string; fallbackHref: string | null; label: string; statusLabel: string; description: string } | null;
	server: { id: string; name: string; host: string; storageNode?: { id: string; basePath: string } | null };
	creator: { id: string; username: string; displayName: string | null } | null;
};

type GlobalStat = { downloadSpeed: string; uploadSpeed: string; numActive: string; numWaiting: string; numStopped: string } | null;

/* ── Status helpers ───────────────────────────────────────── */

const statusBadge: Record<string, string> = {
	PENDING: "border-amber-400/30 bg-amber-400/10 text-amber-100",
	RUNNING: "border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10 text-[var(--text-primary)]",
	COMPLETED: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
	FAILED: "border-rose-400/30 bg-rose-400/10 text-rose-100",
	CANCELLED: "border-slate-400/30 bg-slate-400/10 text-[var(--text-primary)]",
};

function getStatusLabel(t: (k: string) => string): Record<string, string> {
	return {
		PENDING: t("downloadsPage.status.PENDING"),
		RUNNING: t("downloadsPage.status.RUNNING"),
		COMPLETED: t("downloadsPage.status.COMPLETED"),
		FAILED: t("downloadsPage.status.FAILED"),
		CANCELLED: t("downloadsPage.status.CANCELLED"),
	};
}

const categoryIcon: Record<string, string> = {
	video: "🎬", music: "🎵", software: "💿", document: "📄", image: "🖼️", other: "📦",
};

const categories = [
	{ value: "", label: "未分类", icon: "📦" },
	{ value: "video", label: "影视", icon: "🎬" },
	{ value: "music", label: "音乐", icon: "🎵" },
	{ value: "software", label: "软件", icon: "💿" },
	{ value: "document", label: "文档", icon: "📄" },
	{ value: "image", label: "图片", icon: "🖼️" },
];

function urlTypeLabel(url: string, t: (k: string) => string) {
	if (url.startsWith("magnet:?")) return t("downloadsPage.linkType.magnet");
	if (url.startsWith("https://")) return "🔒 HTTPS";
	if (url.startsWith("http://")) return "🔓 HTTP";
	return t("downloadsPage.linkType.unknown");
}

function formatBytes(b: string | number | null): string {
	if (!b) return "—";
	const n = typeof b === "string" ? parseInt(b, 10) : b;
	if (isNaN(n) || n === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(n) / Math.log(1024));
	return `${(n / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatSpeed(b: string | number | null): string {
	if (!b) return "—";
	const n = typeof b === "string" ? parseInt(b, 10) : b;
	if (isNaN(n) || n === 0) return "0 B/s";
	const units = ["B/s", "KB/s", "MB/s", "GB/s"];
	const i = Math.floor(Math.log(n) / Math.log(1024));
	return `${(n / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function computePct(completed: string | null, total: string | null): number {
	const c = parseInt(completed ?? "0", 10);
	const t = parseInt(total ?? "0", 10);
	if (isNaN(c) || isNaN(t) || t === 0) return 0;
	return Math.min(100, Math.round((c / t) * 10) / 10);
}

function getErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

/* ── Main Component ───────────────────────────────────────── */

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

	useEffect(() => {
		const timer = window.setTimeout(() => { void fetchTasks(); }, 0);
		return () => window.clearTimeout(timer);
	}, [fetchTasks]);

	useEffect(() => {
		const hasRunning = tasks.some((t) => t.status === "RUNNING" || t.status === "PENDING");
		if (!hasRunning) return;
		const interval = setInterval(fetchTasks, 5000);
		return () => clearInterval(interval);
	}, [tasks, fetchTasks]);

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
		setMessage(null);
		try {
			if (action === "cancel") {
				await csrfFetch(`/api/downloads?taskId=${taskId}`, { method: "DELETE" });
				setMessage({ type: "success", text: t("downloadsPage.success.cancelled") });
				void fetchTasks();
			} else if (action === "purge") {
				const task = tasks.find((candidate) => candidate.id === taskId);
				const confirmed = window.confirm(
					t("downloadsPage.confirm.purge").replace("${name}", task?.fileName || task?.url || taskId),
				);
				if (!confirmed) return;
				await csrfFetch(`/api/downloads?taskId=${taskId}&purge=1`, { method: "DELETE" });
				setTasks((current) => current.filter((task) => task.id !== taskId));
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

	const filteredTasks = tasks
		.filter((t) => filter === "ALL" || t.status === filter)
		.filter((t) => !categoryFilter || (t.category ?? "") === categoryFilter);

	const runningCount = tasks.filter((t) => t.status === "RUNNING").length;
	const pendingCount = tasks.filter((t) => t.status === "PENDING").length;

	return (
		<div>
			{message && (
				<div role={message.type === "error" ? "alert" : "status"} className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${
					message.type === "success" ? "border-emerald-400/30 bg-emerald-400/5 text-emerald-200" : "border-rose-400/30 bg-rose-400/5 text-rose-200"
				}`}>
					{message.text}
					<button type="button" onClick={() => setMessage(null)} className="ml-3 text-current/50 hover:text-current">✕</button>
				</div>
			)}

			{/* Global Stats Bar */}
			{globalStat && (
				<div data-card className="mb-6 p-4 flex flex-wrap items-center gap-6 text-sm">
					<div>
						<span className="text-[var(--text-muted)]">{t("downloadsPage.stats.globalSpeed")}</span>
						<span className="ml-2 text-[var(--color-action)] font-mono">{formatSpeed(globalStat.downloadSpeed)}</span>
					</div>
					<div>
						<span className="text-[var(--text-muted)]">{t("downloadsPage.stats.active")}</span>
						<span className="ml-2 text-[var(--text-primary)] font-medium">{globalStat.numActive}</span>
					</div>
					<div>
						<span className="text-[var(--text-muted)]">{t("downloadsPage.stats.pending")}</span>
						<span className="ml-2 text-amber-200">{globalStat.numWaiting}</span>
					</div>
					<div className="ml-auto flex items-center gap-2">
						<span className="text-xs text-[var(--text-muted)]">{t("downloadsPage.stats.globalLimit")}</span>
						{canManageNode ? [0, 1024, 5120, 10240].map((kb) => (
							<button key={kb} onClick={() => handleGlobalSpeedLimit(kb)}
								className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-2 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface)]/[0.10] transition"
							>
								{kb === 0 ? t("downloadsPage.stats.unlimited") : `${kb >= 1024 ? (kb / 1024) + "M" : kb + "K"}`}
							</button>
						)) : <span className="text-xs text-[var(--text-muted)]">{t("downloadsPage.stats.needPermission")}</span>}
					</div>
				</div>
			)}

			{/* Quick Stats */}
			{!globalStat && (runningCount > 0 || pendingCount > 0) && (
				<div className="mb-4 flex gap-3 text-xs text-[var(--text-muted)]">
					{runningCount > 0 && <span className="text-[var(--color-action)]">{t("downloadsPage.stats.runningCount").replace("${count}", String(runningCount))}</span>}
					{pendingCount > 0 && <span className="text-amber-300">{t("downloadsPage.stats.pendingCount").replace("${count}", String(pendingCount))}</span>}
				</div>
			)}

			{/* Filter bar */}
			<div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-wrap items-center gap-2">
					{["ALL", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"].map((f) => (
						<button key={f} type="button" onClick={() => setFilter(f)}
							className={`rounded-full border px-3 py-1.5 text-xs transition ${
								filter === f ? "border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10 text-[var(--text-primary)]" : "border-[var(--border)] bg-[var(--surface)]/10 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
							}`}
						>
							{f === "ALL" ? t("downloadsPage.filter.all") : getStatusLabel(t)[f]}
						</button>
					))}
					<div className="w-px h-4 bg-[var(--surface)]/10" />
					{categories.map((c) => (
						<button key={c.value} type="button" onClick={() => setCategoryFilter(categoryFilter === c.value ? null : c.value)}
							className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
								categoryFilter === c.value ? "border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10 text-[var(--text-primary)]" : "border-[var(--border)] bg-[var(--surface)]/[0.04] text-[var(--text-muted)] hover:bg-[var(--surface)]/[0.10]"
							}`}
						>
							{c.icon} {c.label}
						</button>
					))}
				</div>
				{canManage && servers.length > 0 ? (
					<button type="button" onClick={() => setShowForm(!showForm)}
						data-tone="cyan" className="rounded-2xl border border-[var(--color-action-border)]/30 px-5 py-2 text-sm text-[var(--text-primary)] transition hover:bg-[var(--color-action-bg)]/20"
					>
						{showForm ? t("downloadsPage.form.cancelLabel") : t("downloadsPage.form.createLabel")}
					</button>
				) : canManage ? (
					<div data-tone="amber" className="rounded-2xl border border-amber-400/20 px-4 py-2 text-xs text-amber-100">
						{t("downloadsPage.form.noTarget")}
					</div>
				) : null}
			</div>

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

			{/* Task list */}
			{loading ? (
				<EmptyState>{t("downloadsPage.loading")}</EmptyState>
			) : filteredTasks.length === 0 && message?.type !== "error" ? (
			<div data-empty-state className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)]/[0.04]">
				<div className="text-4xl mb-3">⬇️</div>
				<p className="text-sm text-[var(--text-muted)]">{filter === "ALL" ? t("downloadsPage.empty") : t("downloadsPage.emptyFilter").replace("${status}", getStatusLabel(t)[filter] ?? "")}</p>
			</div>
		) : (
			<div className="space-y-2.5">
				{filteredTasks.map((task) => {
					const pct = computePct(task.completedBytes, task.totalBytes);
					return (
						<article data-card key={task.id} className="p-4 hover:bg-[var(--surface)]/[0.04]">
							{/* Header row */}
							<div className="flex flex-wrap items-center gap-2 mb-2.5">
								<span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusBadge[task.status] ?? ""}`}>
									{getStatusLabel(t)[task.status] ?? task.status}
								</span>
								<span className="text-[11px] text-[var(--text-muted)]">{urlTypeLabel(task.url, t)}</span>
								{task.relayMode && <span data-tone="amber" className="rounded-lg border border-amber-400/20 px-2 py-0.5 text-[10px] text-amber-100">中转</span>}
									{task.category && <span className="text-[11px] text-[var(--text-muted)]">{categoryIcon[task.category] ?? "📦"} {task.category}</span>}
									{task.isBatch && <span data-tone="cyan" className="rounded-lg border border-[var(--color-action-border)]/20 px-2 py-0.5 text-[10px] text-[var(--text-primary)]">批量</span>}
								</div>

								{/* URL */}
								<div className="text-sm text-[var(--text-primary)] font-mono break-all leading-relaxed">{task.url.length > 120 ? task.url.slice(0, 117) + "…" : task.url}</div>

								{/* Progress bar */}
								{task.status === "RUNNING" && task.totalBytes && parseInt(task.totalBytes) > 0 && (
									<div className="mt-2.5">
										<div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] mb-1">
											<span>{formatBytes(task.completedBytes)} / {formatBytes(task.totalBytes)}</span>
											<span>{pct}% · {formatSpeed(task.downloadSpeed)}</span>
										</div>
										<div className="h-1.5 rounded-full bg-[var(--surface)]/[0.10] overflow-hidden">
											<div className="h-full rounded-full bg-gradient-to-r from-[var(--color-action-hover)] to-[var(--color-action)] transition-[width] duration-500"
												style={{ width: `${pct}%` }}
											/>
										</div>
									</div>
								)}

								{/* Meta info */}
								<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
									<span>🖥 {task.server.name}</span>
									<span>📂 {task.targetPath}</span>
									{task.fileSize && <span>📦 {formatBytes(task.fileSize)}</span>}
									{task.downloadAccess && <span title={task.downloadAccess.description}>🔁 {task.downloadAccess.statusLabel}</span>}
									<span>🕒 {new Date(task.createdAt).toLocaleString("zh-CN")}</span>
									{task.creator && <span>👤 {task.creator.displayName ?? task.creator.username}</span>}
								</div>

								{/* Error */}
								{task.errorMessage && (
									<div data-tone="rose" className="mt-2 rounded-lg border border-rose-400/20 px-3 py-2 text-xs text-rose-200">{task.errorMessage}</div>
								)}

								{/* Actions */}
								<div className="mt-3 flex gap-2">
									{task.status === "RUNNING" && task.aria2Gid && canManage && (
										<button type="button" onClick={() => handleAction(task.id, "pause")}
											data-tone="amber" className="rounded-lg border border-amber-400/20 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-400/10 transition"
										>
											{t("downloadsPage.action.pause")}
										</button>
									)}
									{task.status === "RUNNING" && task.aria2Gid && canManage && (
										<span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
											<label htmlFor={`limit-${task.id}`}>{t("downloadsPage.action.limit")}</label>
											<input id={`limit-${task.id}`} type="number" min={0} step={1024} placeholder="KB/s"
												defaultValue={task.maxSpeedKb ?? ""}
												onBlur={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 0) handleAction(task.id, `limit:${v}`); }}
												className="w-16 bg-[var(--input-bg)] border-[var(--input-border)] rounded-lg px-1.5 py-0.5 text-xs text-[var(--text-secondary)] focus:outline-none focus:border-[var(--color-action-border)]/50"
											/>
										</span>
									)}
									{task.status === "PENDING" && task.aria2Gid && canManage && (
										<button type="button" onClick={() => handleAction(task.id, "resume")}
											data-tone="emerald" className="rounded-lg border border-emerald-400/20 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-400/10 transition"
										>
											{t("downloadsPage.action.resume")}
										</button>
									)}
									{(task.status === "RUNNING" || task.status === "PENDING") && canManage && (
										<button type="button" onClick={() => handleAction(task.id, "cancel")}
											data-tone="rose" className="rounded-lg border border-rose-400/20 px-3 py-1.5 text-xs text-rose-100 hover:bg-rose-400/10 transition"
										>
											{t("downloadsPage.action.cancel")}
										</button>
									)}
									{canManage && (
										<button type="button" onClick={() => handleAction(task.id, "refresh")}
											className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface)]/[0.10] transition"
										>
											{t("downloadsPage.action.refresh")}
										</button>
									)}
									{task.downloadAccess && (
										<a href={task.downloadAccess.href}
											data-tone="cyan" className="rounded-lg border border-[var(--color-action-border)]/25 px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--color-action-bg)]/20 transition"
											title={task.downloadAccess.description}
										>
											⬇ {task.downloadAccess.label}
										</a>
									)}
									{task.status === "COMPLETED" && task.server.storageNode && (() => {
									const node = task.server.storageNode!;
									const base = (node.basePath || "").replace(/\/+$/, "");
									let rel = task.targetPath || "";
									if (base && rel.startsWith(base)) {
										rel = rel.slice(base.length).replace(/^\/+/, "");
									}
									const href = `/files?nodeId=${encodeURIComponent(node.id)}${rel ? `&path=${encodeURIComponent(rel)}` : ""}`;
									return (
										<a href={href}
											data-tone="emerald" className="rounded-lg border border-emerald-400/20 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-400/10 transition"
											title={t("downloadsPage.action.openFolderTitle")}
										>
											{t("downloadsPage.action.openFolder")}
										</a>
									);
								})()}
								{(task.status === "FAILED" || task.status === "CANCELLED") && canManage && (
									<button type="button" onClick={() => handleAction(task.id, "retry")}
										data-tone="cyan" className="rounded-lg border border-[var(--color-action-border)]/20 px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--color-action-bg)]/10 transition"
										title={t("downloadsPage.action.retryTitle")}
									>
										{t("downloadsPage.action.retry")}
									</button>
								)}
								{(task.status === "COMPLETED" || task.status === "FAILED" || task.status === "CANCELLED") && canManage && (
										<button type="button" onClick={() => handleAction(task.id, "purge")}
											data-tone="rose" className="rounded-lg border border-rose-400/20 px-3 py-1.5 text-xs text-rose-100 hover:bg-rose-400/10 transition"
										>
											{t("downloadsPage.action.delete")}
										</button>
									)}
								</div>
							</article>
						);
					})}
				</div>
			)}
		</div>
	);
}

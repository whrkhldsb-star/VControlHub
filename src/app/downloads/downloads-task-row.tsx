"use client";

import { memo, type MouseEvent } from "react";
import type { DownloadTask } from "./downloads-shared";
import { getStatusLabel, formatSpeed } from "./downloads-shared";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";

const statusBadge: Record<string, string> = {
	PENDING: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
	RUNNING: "border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10 text-[var(--text-primary)]",
	COMPLETED: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
	FAILED: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]",
	CANCELLED: "border-[var(--border)] bg-[var(--surface-hover)] text-[var(--text-primary)]",
};

const categoryIcon: Record<string, string> = {
	video: "🎬", music: "🎵", software: "💿", document: "📄", image: "🖼️", other: "📦",
};

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

function computePct(completed: string | null, total: string | null): number {
	const c = parseInt(completed ?? "0", 10);
	const t = parseInt(total ?? "0", 10);
	if (isNaN(c) || isNaN(t) || t === 0) return 0;
	return Math.min(100, Math.round((c / t) * 10) / 10);
}

export const DownloadTaskRow = memo(function DownloadTaskRow({
	task,
	t,
	canManage,
	busyActions,
	downloadingIds,
	onAction,
	onDownloadClick,
	onPendingPurge,
}: {
	task: DownloadTask;
	t: (k: string) => string;
	canManage: boolean;
	busyActions: Record<string, string>;
	downloadingIds: Record<string, boolean>;
	onAction: (taskId: string, action: string) => void;
	onDownloadClick: (taskId: string) => (event: MouseEvent<HTMLAnchorElement>) => void;
	onPendingPurge: (id: string) => void;
}) {
	const pct = computePct(task.completedBytes, task.totalBytes);
	return (
		<article data-card className="p-4 hover:bg-[var(--surface-elevated)]">
			{/* Header row */}
			<div className="flex flex-wrap items-center gap-2 mb-2.5">
				<span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusBadge[task.status] ?? ""}`}>
					{getStatusLabel(t)[task.status] ?? task.status}
				</span>
				<span className="text-[11px] text-[var(--text-muted)]">{urlTypeLabel(task.url, t)}</span>
				{task.relayMode && <span data-tone="amber" className="rounded-lg border border-[var(--warning-border)] px-2 py-0.5 text-[10px] text-[var(--warning)]">{t("downloadsPage.badge.relay")}</span>}
				{task.category && <span className="text-[11px] text-[var(--text-muted)]">{categoryIcon[task.category] ?? "📦"} {task.category}</span>}
				{task.isBatch && <span data-tone="cyan" className="rounded-lg border border-[var(--color-action-border)]/20 px-2 py-0.5 text-[10px] text-[var(--text-primary)]">{t("downloadsPage.badge.batch")}</span>}
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
					<div className="h-1.5 rounded-full bg-[var(--surface-elevated)] overflow-hidden">
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
				<span>🕒 {new Date(task.createdAt).toLocaleString()}</span>
				{task.creator && <span>👤 {task.creator.displayName ?? task.creator.username}</span>}
			</div>

			{/* Error */}
			{task.errorMessage && (
				<div data-tone="rose" className="mt-2 rounded-lg border border-[var(--danger-border)] px-3 py-2 text-xs text-[var(--danger)]">{task.errorMessage}</div>
			)}

			{/* Actions */}
			<div className="mt-3 flex gap-2">
				{task.status === "RUNNING" && task.aria2Gid && canManage && (
					<button type="button" onClick={() => onAction(task.id, "pause")}
						data-tone="amber" className="rounded-lg border border-[var(--warning-border)] px-3 py-1.5 text-xs text-[var(--warning)] hover:bg-[var(--warning-bg)] transition"
					>
						{t("downloadsPage.action.pause")}
					</button>
				)}
				{task.status === "RUNNING" && task.aria2Gid && canManage && (
					<span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
						<label htmlFor={`limit-${task.id}`}>{t("downloadsPage.action.limit")}</label>
						<input id={`limit-${task.id}`} type="number" min={0} step={1024} placeholder="KB/s"
							defaultValue={task.maxSpeedKb ?? ""}
							onBlur={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 0) onAction(task.id, `limit:${v}`); }}
							className={cn(UI_INPUT, "w-16 px-1.5 py-0.5 text-xs text-[var(--text-secondary)]")}
						/>
					</span>
				)}
				{task.status === "PENDING" && task.aria2Gid && canManage && (
					<button type="button" onClick={() => onAction(task.id, "resume")}
						data-tone="emerald" className="rounded-lg border border-[var(--success-border)] px-3 py-1.5 text-xs text-[var(--success)] hover:bg-[var(--success-bg)] transition"
					>
						{t("downloadsPage.action.resume")}
					</button>
				)}
				{(task.status === "RUNNING" || task.status === "PENDING") && canManage && (
					<button type="button" onClick={() => onAction(task.id, "cancel")}
						data-tone="rose" className="rounded-lg border border-[var(--danger-border)] px-3 py-1.5 text-xs text-[var(--danger)] hover:bg-[var(--danger-bg)] transition"
					>
						{t("downloadsPage.action.cancel")}
					</button>
				)}
				{canManage && (
					<button type="button" onClick={() => onAction(task.id, "refresh")}
						className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] transition"
					>
						{busyActions[`${task.id}:refresh`] ? t("downloadsPage.action.refreshing") : t("downloadsPage.action.refresh")}
					</button>
				)}
				{task.downloadAccess && (
					<a href={task.downloadAccess.href}
						onClick={onDownloadClick(task.id)}
						data-tone="cyan" className="rounded-lg border border-[var(--color-action-border)]/25 px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--color-action-bg)]/20 transition"
						title={task.downloadAccess.description}
					>
						{downloadingIds[task.id] ? t("downloadsPage.action.downloading") : t("downloadsPage.action.downloadFile")}
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
							data-tone="emerald" className="rounded-lg border border-[var(--success-border)] px-3 py-1.5 text-xs text-[var(--success)] hover:bg-[var(--success-bg)] transition"
							title={t("downloadsPage.action.openFolderTitle")}
						>
							{t("downloadsPage.action.openFolder")}
						</a>
					);
				})()}
				{(task.status === "FAILED" || task.status === "CANCELLED") && canManage && (
					<button type="button" onClick={() => onAction(task.id, "retry")} disabled={Boolean(busyActions[`${task.id}:retry`])}
						data-tone="cyan" className="rounded-lg border border-[var(--color-action-border)]/20 px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--color-action-bg)]/10 transition"
						title={t("downloadsPage.action.retryTitle")}
					>
						{busyActions[`${task.id}:retry`] ? t("downloadsPage.action.retrying") : t("downloadsPage.action.retry")}
					</button>
				)}
				{(task.status === "COMPLETED" || task.status === "FAILED" || task.status === "CANCELLED") && canManage && (
					<button type="button" onClick={() => onPendingPurge(task.id)}
						data-tone="rose" className="rounded-lg border border-[var(--danger-border)] px-3 py-1.5 text-xs text-[var(--danger)] hover:bg-[var(--danger-bg)] transition"
					>
						{t("downloadsPage.action.delete")}
					</button>
				)}
			</div>
		</article>
	);
}, (prev, next) => {
	const p = prev.task, n = next.task;
	return (
		prev.canManage === next.canManage &&
		p.id === n.id &&
		p.status === n.status &&
		p.url === n.url &&
		p.completedBytes === n.completedBytes &&
		p.totalBytes === n.totalBytes &&
		p.downloadSpeed === n.downloadSpeed &&
		p.fileSize === n.fileSize &&
		p.errorMessage === n.errorMessage &&
		p.maxSpeedKb === n.maxSpeedKb &&
		p.relayMode === n.relayMode &&
		p.isBatch === n.isBatch &&
		p.category === n.category &&
		p.aria2Gid === n.aria2Gid &&
		p.targetPath === n.targetPath &&
		p.createdAt === n.createdAt &&
		p.server?.name === n.server?.name &&
		p.server?.storageNode?.id === n.server?.storageNode?.id &&
		p.server?.storageNode?.basePath === n.server?.storageNode?.basePath &&
		p.creator?.id === n.creator?.id &&
		p.creator?.username === n.creator?.username &&
		p.creator?.displayName === n.creator?.displayName &&
		p.downloadAccess?.href === n.downloadAccess?.href &&
		p.downloadAccess?.statusLabel === n.downloadAccess?.statusLabel &&
		p.downloadAccess?.description === n.downloadAccess?.description &&
		p.downloadAccess?.label === n.downloadAccess?.label &&
		p.downloadAccess?.mode === n.downloadAccess?.mode &&
		p.downloadAccess?.transport === n.downloadAccess?.transport &&
		p.downloadAccess?.fallbackHref === n.downloadAccess?.fallbackHref &&
		prev.busyActions[`${p.id}:refresh`] === next.busyActions[`${p.id}:refresh`] &&
		prev.busyActions[`${p.id}:retry`] === next.busyActions[`${p.id}:retry`] &&
		prev.downloadingIds[p.id] === next.downloadingIds[p.id] &&
		prev.t === next.t
	);
});


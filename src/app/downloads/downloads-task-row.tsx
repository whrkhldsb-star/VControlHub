"use client";

import { memo, type MouseEvent } from "react";
import type { DownloadTask } from "./downloads-shared";
import { getStatusLabel, formatSpeed } from "./downloads-shared";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { formatBytes } from "@/lib/format/bytes";
import { ActionButton } from "@/components/action-button";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { formatDateTime } from "@/lib/datetime/format";
import type { Locale } from "@/lib/i18n/translations";
import { ProgressBar } from "@/components/ui-primitives";
import { File, Folder, HardDrive, ImageIcon, Music2, RefreshCw, Server, User, Video } from "@/components/icons";

const statusBadge: Record<string, StatusTone> = {
	PENDING: "warning",
	RUNNING: "accent",
	COMPLETED: "success",
	FAILED: "danger",
	CANCELLED: "neutral",
};

const categoryIcon = {
	video: Video, music: Music2, software: HardDrive, document: File, image: ImageIcon, other: File,
};

function urlTypeLabel(url: string, t: (k: string, vars?: Record<string, string | number>) => string) {
	if (url.startsWith("magnet:?")) return t("downloadsPage.linkType.magnet");
	if (url.startsWith("https://")) return "HTTPS";
	if (url.startsWith("http://")) return "HTTP";
	return t("downloadsPage.linkType.unknown");
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
	locale = "zh",
	canManage,
	busyActions,
	downloadingIds,
	onAction,
	onDownloadClick,
	onPendingPurge,
}: {
	task: DownloadTask;
	t: (k: string, vars?: Record<string, string | number>) => string;
	locale?: Locale;
	canManage: boolean;
	busyActions: Record<string, string>;
	downloadingIds: Record<string, boolean>;
	onAction: (taskId: string, action: string) => void;
	onDownloadClick: (taskId: string) => (event: MouseEvent<HTMLAnchorElement>) => void;
	onPendingPurge: (id: string) => void;
}) {
	const pct = computePct(task.completedBytes, task.totalBytes);
	const CategoryIcon = categoryIcon[task.category as keyof typeof categoryIcon] ?? File;
	return (
		<article data-card className="p-4 hover:bg-[var(--surface-elevated)]">
			{/* Header row */}
			<div className="flex flex-wrap items-center gap-2 mb-2.5">
				<StatusBadge tone={statusBadge[task.status] ?? "neutral"} className="text-xs">
					{getStatusLabel(t)[task.status] ?? task.status}
				</StatusBadge>
				<span className="text-xs text-[var(--text-muted)]">{urlTypeLabel(task.url, t)}</span>
				{task.relayMode && <span data-tone="amber" className="rounded-lg border border-[var(--warning-border)] px-2 py-0.5 text-xs text-[var(--warning)]">{t("downloadsPage.badge.relay")}</span>}
				{task.category && <span className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]"><CategoryIcon size={14} aria-hidden />{task.category}</span>}
				{task.isBatch && <span data-tone="cyan" className="rounded-lg border border-[var(--color-action-border)]/20 px-2 py-0.5 text-xs text-[var(--text-primary)]">{t("downloadsPage.badge.batch")}</span>}
			</div>

			{/* URL */}
			<div className="text-sm text-[var(--text-primary)] font-mono break-all leading-relaxed">{task.url.length > 120 ? task.url.slice(0, 117) + "…" : task.url}</div>

			{/* Progress bar */}
			{task.status === "RUNNING" && task.totalBytes && parseInt(task.totalBytes) > 0 && (
				<div className="mt-2.5">
					<div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-1">
						<span>{formatBytes(task.completedBytes)} / {formatBytes(task.totalBytes)}</span>
						<span>{pct}% · {formatSpeed(task.downloadSpeed)}</span>
					</div>
					<ProgressBar value={pct} height="sm" label={task.url} />
				</div>
			)}

			{/* Meta info */}
			<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
				<span className="inline-flex items-center gap-1.5"><Server size={14} aria-hidden />{task.server.name}</span>
				<span className="inline-flex min-w-0 items-center gap-1.5 break-all"><Folder size={14} aria-hidden className="shrink-0" />{task.targetPath}</span>
				{task.fileSize && <span className="inline-flex items-center gap-1.5"><File size={14} aria-hidden />{formatBytes(task.fileSize)}</span>}
				{task.downloadAccess && <span className="inline-flex items-center gap-1.5" title={task.downloadAccess.description}><RefreshCw size={14} aria-hidden />{task.downloadAccess.statusLabel}</span>}
				<span>{formatDateTime(task.createdAt, locale)}</span>
				{task.creator && <span className="inline-flex items-center gap-1.5"><User size={14} aria-hidden />{task.creator.displayName ?? task.creator.username}</span>}
			</div>

			{/* Error */}
			{task.errorMessage && (
				<div data-tone="rose" className="mt-2 rounded-lg border border-[var(--danger-border)] px-3 py-2 text-xs text-[var(--danger)]">{task.errorMessage}</div>
			)}

			{/* Actions */}
			<div className="mt-3 flex gap-2">
				{task.status === "RUNNING" && task.aria2Gid && canManage && (
					<ActionButton variant="outline" onClick={() => onAction(task.id, "pause")} className="!px-3 !py-1.5 !text-sm"
					>
						{t("downloadsPage.action.pause")}
					</ActionButton>
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
					<ActionButton variant="success" onClick={() => onAction(task.id, "resume")} className="!px-3 !py-1.5 !text-sm"
					>
						{t("downloadsPage.action.resume")}
					</ActionButton>
				)}
				{(task.status === "RUNNING" || task.status === "PENDING") && canManage && (
					<ActionButton variant="danger" onClick={() => onAction(task.id, "cancel")} className="!px-3 !py-1.5 !text-sm"
					>
						{t("downloadsPage.action.cancel")}
					</ActionButton>
				)}
				{canManage && (
					<ActionButton variant="secondary" onClick={() => onAction(task.id, "refresh")} className="!px-3 !py-1.5 !text-sm"
					>
						{busyActions[`${task.id}:refresh`] ? t("downloadsPage.action.refreshing") : t("downloadsPage.action.refresh")}
					</ActionButton>
				)}
				{task.downloadAccess && (
					<a href={task.downloadAccess.href}
						onClick={onDownloadClick(task.id)}
						data-action-button data-variant="outline" className="!px-3 !py-1.5 !text-sm !font-medium"
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
							data-action-button data-variant="success" className="!px-3 !py-1.5 !text-sm"
							title={t("downloadsPage.action.openFolderTitle")}
						>
							{t("downloadsPage.action.openFolder")}
						</a>
					);
				})()}
				{(task.status === "FAILED" || task.status === "CANCELLED") && canManage && (
					<ActionButton variant="primary" onClick={() => onAction(task.id, "retry")} disabled={Boolean(busyActions[`${task.id}:retry`])} className="!px-3 !py-1.5 !text-sm"
						title={t("downloadsPage.action.retryTitle")}
					>
						{busyActions[`${task.id}:retry`] ? t("downloadsPage.action.retrying") : t("downloadsPage.action.retry")}
					</ActionButton>
				)}
				{(task.status === "COMPLETED" || task.status === "FAILED" || task.status === "CANCELLED") && canManage && (
					<ActionButton variant="danger" onClick={() => onPendingPurge(task.id)} className="!px-3 !py-1.5 !text-sm"
					>
						{t("downloadsPage.action.delete")}
					</ActionButton>
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

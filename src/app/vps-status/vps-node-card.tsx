"use client";

/**
 * Card view for a single VPS node plus the small format helpers shared
 * with the table view. Extracted 1:1 from `vps-status-client.tsx`.
 */

import { formatBytes } from "@/lib/format/bytes";
import { toDateLocale } from "@/lib/i18n/locale-format";

import {
	statusLabelKey,
	statusToneClasses,
	unknownTone,
	usageBarColor,
	usageColor,
} from "@/app/health/health-dashboard-helpers";
import type { ServerHealth } from "@/app/health/health-types";
import { SparklineChartLazy } from "@/app/health/sparkline-chart-lazy";

export function formatKbps(kbps: number | undefined): string {
	if (kbps === undefined || !Number.isFinite(kbps)) return "—";
	if (kbps >= 1_000_000) return `${(kbps / 1_000_000).toFixed(1)} Gbps`;
	if (kbps >= 1_000) return `${(kbps / 1_000).toFixed(1)} Mbps`;
	return `${Math.round(kbps)} Kbps`;
}

export function formatMem(usedMb?: number, totalMb?: number): string {
	if (usedMb === undefined || totalMb === undefined || totalMb <= 0) return "—";
	const fmt = (mb: number) =>
		mb >= 1024 ? `${(mb / 1024).toFixed(mb >= 10_240 ? 0 : 1)} GB` : `${Math.round(mb)} MB`;
	return `${fmt(usedMb)} / ${fmt(totalMb)}`;
}

export function formatDisk(used?: string, total?: string): string {
	if (!used && !total) return "—";
	if (used && total) return `${used} / ${total}`;
	return used || total || "—";
}

function MetricBar({
	label,
	value,
	detail,
}: {
	label: string;
	value: number | undefined;
	detail?: string;
}) {
	if (value === undefined) {
		return (
			<div className="space-y-1.5">
				<div className="flex items-center justify-between gap-2 text-[11px]">
					<span className="text-[var(--text-muted)]">{label}</span>
					<span className="font-mono text-[var(--text-muted)]">—</span>
				</div>
				<div className="h-2 overflow-hidden rounded-full bg-[var(--surface-hover)]" />
			</div>
		);
	}
	return (
		<div className="space-y-1.5">
			<div className="flex items-center justify-between gap-2 text-[11px]">
				<span className="text-[var(--text-muted)]">{label}</span>
				<span className={`shrink-0 font-mono tabular-nums ${usageColor(value)}`}>
					{value.toFixed(1)}%
					{detail ? (
						<span className="ml-1.5 font-normal text-[var(--text-muted)]">{detail}</span>
					) : null}
				</span>
			</div>
			<div className="h-2 overflow-hidden rounded-full bg-[var(--surface-hover)]">
				<div
					className={`h-full rounded-full transition-[width] duration-500 ${usageBarColor(value)}`}
					style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
				/>
			</div>
		</div>
	);
}

export function VpsNodeCard({
	server,
	expanded,
	onToggle,
	history,
	historyError,
	locale,
	t,
}: {
	server: ServerHealth;
	expanded: boolean;
	onToggle: () => void;
	history?: { cpu: number; mem: number; disk: number; online: boolean; t: string }[];
	historyError?: string;
	locale: "zh" | "en";
	t: (key: string) => string;
}) {
	const sc = statusToneClasses[server.status] ?? unknownTone;
	const isOffline = server.status === "offline" || server.status === "unknown";
	const memDetail = formatMem(server.memUsedMb, server.memTotalMb);
	const diskDetail = formatDisk(server.diskUsedLabel, server.diskTotalLabel);

	return (
		<article
			className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-[var(--surface)] shadow-[0_1px_0_rgba(255,255,255,0.04)_inset] transition duration-200 hover:-translate-y-0.5 hover:shadow-lg ${
				server.status === "critical"
					? "border-[var(--danger-border)]"
					: server.status === "warning"
						? "border-[var(--warning-border)]"
						: "border-[var(--border)] hover:border-[var(--border-strong,var(--border))]"
			}`}
		>
			<div
				className={`absolute inset-x-0 top-0 h-1 ${
					server.status === "healthy"
						? "bg-[var(--success)]"
						: server.status === "warning"
							? "bg-[var(--warning)]"
							: server.status === "critical"
								? "bg-[var(--danger)]"
								: "bg-[var(--border)]"
				}`}
				aria-hidden
			/>

			<div className="flex items-start justify-between gap-3 p-4 pb-3 pt-5">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="relative flex h-2.5 w-2.5 shrink-0">
							<span
								className={`absolute inline-flex h-full w-full rounded-full opacity-50 ${sc.dot} ${
									!isOffline && server.status === "healthy" ? "animate-ping" : ""
								}`}
							/>
							<span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${sc.dot}`} />
						</span>
						<h3 className="truncate text-sm font-semibold tracking-tight text-[var(--text-primary)]">
							{server.serverName}
						</h3>
					</div>
					<p className="mt-1 truncate font-mono text-[11px] text-[var(--text-muted)]">{server.host}</p>
				</div>
				<span
					className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${sc.bg} ${sc.text}`}
				>
					{t(statusLabelKey(server.status))}
				</span>
			</div>

			<div className="space-y-3 px-4 pb-3">
				<MetricBar label="CPU" value={server.cpu} />
				<MetricBar
					label={t("healthPage.ui.memory")}
					value={server.mem}
					detail={memDetail !== "—" ? memDetail : undefined}
				/>
				<MetricBar
					label={t("healthPage.ui.disk")}
					value={server.diskMax}
					detail={diskDetail !== "—" ? diskDetail : undefined}
				/>
			</div>

			<div className="mt-auto grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[var(--border-subtle)] bg-[var(--surface-elevated)]/40 px-4 py-3 text-[11px]">
				<div className="flex justify-between gap-2">
					<span className="text-[var(--text-muted)]">{t("healthPage.ui.uptime")}</span>
					<span className="truncate font-medium text-[var(--text-secondary)]">{server.uptime ?? "—"}</span>
				</div>
				<div className="flex justify-between gap-2">
					<span className="text-[var(--text-muted)]">{t("vpsStatusPage.metric.load")}</span>
					<span className="font-mono tabular-nums text-[var(--text-secondary)]">
						{server.loadAvg1m !== undefined ? server.loadAvg1m.toFixed(2) : "—"}
					</span>
				</div>
				<div className="flex justify-between gap-2">
					<span className="text-[var(--text-muted)]">{t("vpsStatusPage.metric.netIn")}</span>
					<span className="font-mono tabular-nums text-[var(--text-secondary)]">
						{formatKbps(server.networkInKbps)}
					</span>
				</div>
				<div className="flex justify-between gap-2">
					<span className="text-[var(--text-muted)]">{t("vpsStatusPage.metric.netOut")}</span>
					<span className="font-mono tabular-nums text-[var(--text-secondary)]">
						{formatKbps(server.networkOutKbps)}
					</span>
				</div>
				<div className="col-span-2 flex justify-between gap-2 border-t border-[var(--border-subtle)] pt-2">
					<span className="text-[var(--text-muted)]">{t("vpsStatusPage.metric.monthTraffic")}</span>
					<span className="font-mono tabular-nums text-[var(--text-secondary)]">
						↓{formatBytes(server.monthlyRxBytes)} · ↑{formatBytes(server.monthlyTxBytes)}
					</span>
				</div>
			</div>

			{server.error ? (
				<p className="border-t border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-2 text-[11px] text-[var(--danger)]">
					{server.error}
				</p>
			) : null}

			<div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-4 py-2.5">
				<span className="text-[10px] text-[var(--text-muted)]">
					{t("healthPage.ui.lastRefresh")}:{" "}
					{server.lastCheck
						? new Date(server.lastCheck).toLocaleString(toDateLocale(locale), {
								month: "2-digit",
								day: "2-digit",
								hour: "2-digit",
								minute: "2-digit",
								hour12: false,
							})
						: "—"}
				</span>
				<button
					type="button"
					onClick={onToggle}
					className="rounded-full px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]"
				>
					{expanded ? t("healthPage.ui.collapse") : t("healthPage.ui.trend")}
				</button>
			</div>

			{expanded ? (
				<div className="border-t border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3">
					{historyError ? (
						<div
							role="alert"
							className="rounded-xl border border-[var(--danger-border)] p-2 text-xs text-[var(--danger)]"
						>
							{historyError}
						</div>
					) : history ? (
						<div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-2">
							<SparklineChartLazy data={history} locale={locale} />
						</div>
					) : (
						<div className="h-20 animate-pulse rounded-xl bg-[var(--surface)]" />
					)}
				</div>
			) : null}
		</article>
	);
}

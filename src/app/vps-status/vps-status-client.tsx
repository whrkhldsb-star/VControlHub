"use client";

/**
 * VPS fleet status — Komari / Nezha-inspired probe dashboard.
 *
 * Metrics come from SSH sampling (password/key), not a host agent.
 * Auto-refresh interval is the shared Settings preference only
 * (`vps-preferences.autoRefreshInterval`) — no local toggle.
 */

import { useMemo, useState } from "react";
import Link from "next/link";

import { toDateLocale } from "@/lib/i18n/locale-format";
import { useI18n } from "@/lib/i18n/use-locale";
import { getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";

import { CapacityForecastPanel } from "@/app/health/capacity-forecast-panel";
import {
	statusLabelKey,
	statusToneClasses,
	tt as applyTemplate,
	unknownTone,
	usageBarColor,
	usageColor,
} from "@/app/health/health-dashboard-helpers";
import { FleetResourceSummary, SummaryCard } from "@/app/health/health-dashboard-parts";
import type { ServerHealth } from "@/app/health/health-types";
import { SparklineChartLazy } from "@/app/health/sparkline-chart-lazy";
import { useHealthData } from "@/app/health/use-health-data";

type Props = { serverCount: number };

function formatKbps(kbps: number | undefined): string {
	if (kbps === undefined || !Number.isFinite(kbps)) return "—";
	if (kbps >= 1_000_000) return `${(kbps / 1_000_000).toFixed(1)} Gbps`;
	if (kbps >= 1_000) return `${(kbps / 1_000).toFixed(1)} Mbps`;
	return `${Math.round(kbps)} Kbps`;
}

function formatBytes(bytes: number | undefined): string {
	if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "—";
	const units = ["B", "KB", "MB", "GB", "TB", "PB"];
	let n = bytes;
	let i = 0;
	while (n >= 1024 && i < units.length - 1) {
		n /= 1024;
		i += 1;
	}
	const digits = i === 0 ? 0 : n >= 100 ? 0 : n >= 10 ? 1 : 2;
	return `${n.toFixed(digits)} ${units[i]}`;
}

function formatMem(usedMb?: number, totalMb?: number): string {
	if (usedMb === undefined || totalMb === undefined || totalMb <= 0) return "—";
	const fmt = (mb: number) =>
		mb >= 1024 ? `${(mb / 1024).toFixed(mb >= 10_240 ? 0 : 1)} GB` : `${Math.round(mb)} MB`;
	return `${fmt(usedMb)} / ${fmt(totalMb)}`;
}

function formatDisk(used?: string, total?: string): string {
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

function VpsNodeCard({
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

export function VpsStatusClient({ serverCount }: Props) {
	const { locale, t } = useI18n();
	const browserLocale = toDateLocale(locale);
	const {
		overview,
		history,
		historyErrors,
		loadError,
		lastRefresh,
		isRefreshing,
		refreshIntervalSeconds,
		fetchHealth,
		fetchHistory,
	} = useHealthData({ browserLocale, locale, mode: "vps" });

	const [expandedServer, setExpandedServer] = useState<string | null>(null);
	const [filter, setFilter] = useState<"all" | "online" | "issue">("all");
	const [viewMode, setViewMode] = useState<"cards" | "table">(() => {
		if (typeof window === "undefined") return "cards";
		try {
			const saved = window.localStorage.getItem("vch.vpsStatus.viewMode");
			if (saved === "cards" || saved === "table") return saved;
		} catch {
			/* ignore */
		}
		return "cards";
	});

	const setViewModePersist = (mode: "cards" | "table") => {
		setViewMode(mode);
		try {
			window.localStorage.setItem("vch.vpsStatus.viewMode", mode);
		} catch {
			/* ignore */
		}
	};

	const tt = (key: string, vars?: Record<string, string | number>) => applyTemplate(t, key, vars);

	const filteredServers = useMemo(() => {
		const list = overview?.servers ?? [];
		if (filter === "online") {
			return list.filter((s) => s.status === "healthy" || s.status === "warning");
		}
		if (filter === "issue") {
			return list.filter(
				(s) =>
					s.status === "warning" ||
					s.status === "critical" ||
					s.status === "offline" ||
					s.status === "unknown",
			);
		}
		return list;
	}, [overview, filter]);

	const toggleExpand = async (serverId: string) => {
		if (expandedServer === serverId) {
			setExpandedServer(null);
			return;
		}
		setExpandedServer(serverId);
		if (!history[serverId]) await fetchHistory(serverId);
	};

	const loading = overview === null && loadError === null;
	const intervalLabel =
		refreshIntervalSeconds <= 0
			? t("healthPage.ui.autoRefreshOff")
			: getRefreshIntervalLabel(refreshIntervalSeconds);

	if (!overview && loadError) {
		return (
			<div
				data-tone="rose"
				className="rounded-xl border border-[var(--danger-border)] p-4 text-sm text-[var(--danger)]"
				role="alert"
			>
				<div>{loadError}</div>
				<button
					type="button"
					onClick={() => void fetchHealth()}
					disabled={isRefreshing}
					data-action-button
					data-variant="danger"
					className="!mt-3 !px-3 !py-1.5 !text-xs disabled:cursor-not-allowed disabled:opacity-50"
				>
					{isRefreshing ? t("healthPage.ui.retrying") : t("healthPage.ui.retryLoad")}
				</button>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{loadError ? (
				<div
					role="alert"
					data-tone="rose"
					className="rounded-xl border border-[var(--danger-border)] p-3 text-sm text-[var(--danger)]"
				>
					{loadError}
				</div>
			) : null}

			<section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
				<SummaryCard
					label={t("healthPage.summary.total")}
					value={overview?.total ?? (serverCount > 0 ? serverCount : "—")}
					color="slate"
				/>
				<SummaryCard label={t("healthPage.summary.online")} value={overview?.online ?? "—"} color="emerald" />
				<SummaryCard label={t("healthPage.summary.warning")} value={overview?.warning ?? "—"} color="amber" />
				<SummaryCard label={t("healthPage.summary.critical")} value={overview?.critical ?? "—"} color="rose" />
				<SummaryCard label={t("healthPage.summary.offline")} value={overview?.offline ?? "—"} color="slate" />
			</section>

			{overview && overview.servers.length > 0 ? (
				<FleetResourceSummary overview={overview} t={t} tt={tt} />
			) : null}

			<CapacityForecastPanel />

			<div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-wrap items-center gap-2">
					{(
						[
							["all", t("vpsStatusPage.filter.all")],
							["online", t("vpsStatusPage.filter.online")],
							["issue", t("vpsStatusPage.filter.issue")],
						] as const
					).map(([key, label]) => (
						<button
							key={key}
							type="button"
							onClick={() => setFilter(key)}
							className={`rounded-full px-3 py-1 text-xs font-medium transition ${
								filter === key
									? "bg-[var(--color-action)] text-[var(--on-accent,white)]"
									: "bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
							}`}
						>
							{label}
						</button>
					))}
					<span className="ml-1 text-xs text-[var(--text-muted)]">
						{tt("vpsStatusPage.showing", { count: filteredServers.length })}
					</span>
					<div className="ml-2 inline-flex rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] p-0.5">
						{(
							[
								["cards", t("vpsStatusPage.view.cards")],
								["table", t("vpsStatusPage.view.table")],
							] as const
						).map(([key, label]) => (
							<button
								key={key}
								type="button"
								onClick={() => setViewModePersist(key)}
								aria-pressed={viewMode === key}
								className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
									viewMode === key
										? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm"
										: "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
								}`}
							>
								{label}
							</button>
						))}
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<span className="text-xs text-[var(--text-muted)]">
						{t("healthPage.ui.lastRefresh")}: {lastRefresh || "—"}
					</span>
					<span className="rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
						{refreshIntervalSeconds <= 0
							? t("vpsStatusPage.refresh.off")
							: tt("vpsStatusPage.refresh.every", { label: intervalLabel })}
					</span>
					<Link
						href="/health"
						data-action-button
						data-variant="outline"
						className="!px-3 !text-xs"
					>
						{t("vpsStatusPage.gotoSystemHealth")}
					</Link>
					<button
						type="button"
						onClick={() => void fetchHealth()}
						disabled={isRefreshing || loading}
						aria-label={t("healthPage.ui.refreshAria")}
						data-action-button
						data-variant="secondary"
						className="inline-flex min-h-11 items-center !px-3 !text-xs disabled:cursor-not-allowed disabled:opacity-60"
					>
						{isRefreshing || loading ? t("healthPage.ui.refreshing") : t("healthPage.ui.refresh")}
					</button>
				</div>
			</div>

			{loading ? (
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
					{Array.from({ length: Math.min(Math.max(serverCount, 1), 8) }).map((_, i) => (
						<div
							key={i}
							className="h-64 animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
						/>
					))}
				</div>
			) : filteredServers.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-muted)]">
					{t("vpsStatusPage.empty")}
				</div>
			) : viewMode === "table" ? (
				<div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
					<table className="min-w-full border-collapse text-left text-xs">
						<thead className="bg-[var(--surface-elevated)] text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
							<tr>
								<th className="px-3 py-2.5 font-medium">{t("vpsStatusPage.table.name")}</th>
								<th className="px-3 py-2.5 font-medium">{t("vpsStatusPage.table.status")}</th>
								<th className="px-3 py-2.5 font-medium">{t("vpsStatusPage.table.cpu")}</th>
								<th className="px-3 py-2.5 font-medium">{t("vpsStatusPage.table.mem")}</th>
								<th className="px-3 py-2.5 font-medium">{t("vpsStatusPage.table.disk")}</th>
								<th className="px-3 py-2.5 font-medium">{t("vpsStatusPage.table.load")}</th>
								<th className="px-3 py-2.5 font-medium">{t("vpsStatusPage.table.net")}</th>
								<th className="px-3 py-2.5 font-medium">{t("vpsStatusPage.table.monthTraffic")}</th>
								<th className="px-3 py-2.5 font-medium">{t("vpsStatusPage.table.uptime")}</th>
								<th className="px-3 py-2.5 font-medium">{t("vpsStatusPage.table.updated")}</th>
							</tr>
						</thead>
						<tbody>
							{filteredServers.map((server) => {
								const sc = statusToneClasses[server.status] ?? unknownTone;
								return (
									<tr
										key={server.serverId}
										className="border-t border-[var(--border-subtle)] hover:bg-[var(--surface-elevated)]/60"
									>
										<td className="px-3 py-2.5">
											<div className="flex items-center gap-2">
												<span className={`inline-flex h-2 w-2 rounded-full ${sc.dot}`} />
												<div className="min-w-0">
													<div className="truncate font-medium text-[var(--text-primary)]">
														{server.serverName}
													</div>
													<div className="truncate font-mono text-[10px] text-[var(--text-muted)]">
														{server.host}
													</div>
												</div>
											</div>
										</td>
										<td className="px-3 py-2.5">
											<span
												className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${sc.bg} ${sc.text}`}
											>
												{t(statusLabelKey(server.status))}
											</span>
										</td>
										<td className={`px-3 py-2.5 font-mono tabular-nums ${usageColor(server.cpu)}`}>
											{server.cpu !== undefined ? `${server.cpu.toFixed(1)}%` : "—"}
										</td>
										<td className={`px-3 py-2.5 font-mono tabular-nums ${usageColor(server.mem)}`}>
											{server.mem !== undefined ? `${server.mem.toFixed(1)}%` : "—"}
											{server.memUsedMb !== undefined ? (
												<div className="text-[10px] font-normal text-[var(--text-muted)]">
													{formatMem(server.memUsedMb, server.memTotalMb)}
												</div>
											) : null}
										</td>
										<td className={`px-3 py-2.5 font-mono tabular-nums ${usageColor(server.diskMax)}`}>
											{server.diskMax !== undefined ? `${server.diskMax.toFixed(1)}%` : "—"}
											{server.diskUsedLabel ? (
												<div className="text-[10px] font-normal text-[var(--text-muted)]">
													{formatDisk(server.diskUsedLabel, server.diskTotalLabel)}
												</div>
											) : null}
										</td>
										<td className="px-3 py-2.5 font-mono tabular-nums text-[var(--text-secondary)]">
											{server.loadAvg1m !== undefined ? server.loadAvg1m.toFixed(2) : "—"}
										</td>
										<td className="px-3 py-2.5 font-mono tabular-nums text-[var(--text-secondary)]">
											{formatKbps(server.networkInKbps)} / {formatKbps(server.networkOutKbps)}
										</td>
										<td className="px-3 py-2.5 font-mono tabular-nums text-[var(--text-secondary)]">
											↓{formatBytes(server.monthlyRxBytes)} / ↑{formatBytes(server.monthlyTxBytes)}
										</td>
										<td className="px-3 py-2.5 text-[var(--text-secondary)]">{server.uptime ?? "—"}</td>
										<td className="px-3 py-2.5 text-[var(--text-muted)]">
											{server.lastCheck
												? new Date(server.lastCheck).toLocaleString(browserLocale, {
														month: "2-digit",
														day: "2-digit",
														hour: "2-digit",
														minute: "2-digit",
														hour12: false,
													})
												: "—"}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			) : (
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
					{filteredServers.map((server) => (
						<VpsNodeCard
							key={server.serverId}
							server={server}
							expanded={expandedServer === server.serverId}
							onToggle={() => void toggleExpand(server.serverId)}
							history={history[server.serverId]}
							historyError={historyErrors[server.serverId]}
							locale={locale}
							t={t}
						/>
					))}
				</div>
			)}
		</div>
	);
}

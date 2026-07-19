"use client";

/**
 * VPS fleet status — Komari / Nezha-inspired probe dashboard.
 *
 * Metrics come from SSH sampling (password/key), not a host agent:
 * latency / TCP RTT / agent version are intentionally omitted.
 * Auto-refresh interval is the shared Settings preference
 * (`vps-preferences.autoRefreshInterval`), same as monitoring/docker.
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

function MetricBar({
	label,
	value,
}: {
	label: string;
	value: number | undefined;
}) {
	if (value === undefined) {
		return (
			<div className="space-y-1">
				<div className="flex items-center justify-between text-[11px]">
					<span className="text-[var(--text-muted)]">{label}</span>
					<span className="font-mono text-[var(--text-muted)]">—</span>
				</div>
				<div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-hover)]" />
			</div>
		);
	}
	return (
		<div className="space-y-1">
			<div className="flex items-center justify-between text-[11px]">
				<span className="text-[var(--text-muted)]">{label}</span>
				<span className={`font-mono tabular-nums ${usageColor(value)}`}>
					{value.toFixed(1)}%
				</span>
			</div>
			<div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-hover)]">
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

	return (
		<article
			className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-[var(--surface)] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] transition hover:border-[var(--border-strong,var(--border))] hover:shadow-lg ${
				server.status === "critical"
					? "border-[var(--danger-border)]"
					: server.status === "warning"
						? "border-[var(--warning-border)]"
						: "border-[var(--border)]"
			}`}
		>
			{/* status accent bar */}
			<div
				className={`absolute inset-x-0 top-0 h-0.5 ${
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

			<div className="flex items-start justify-between gap-3 p-4 pb-2">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span
							className={`relative flex h-2.5 w-2.5 shrink-0 ${isOffline ? "" : ""}`}
						>
							<span
								className={`absolute inline-flex h-full w-full rounded-full opacity-60 ${sc.dot} ${
									!isOffline && server.status === "healthy" ? "animate-ping" : ""
								}`}
							/>
							<span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${sc.dot}`} />
						</span>
						<h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
							{server.serverName}
						</h3>
					</div>
					<p className="mt-1 truncate font-mono text-[11px] text-[var(--text-muted)]">
						{server.host}
					</p>
				</div>
				<span
					className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${sc.bg} ${sc.text}`}
				>
					{t(statusLabelKey(server.status))}
				</span>
			</div>

			<div className="space-y-2.5 px-4 py-2">
				<MetricBar label="CPU" value={server.cpu} />
				<MetricBar label={t("healthPage.ui.memory")} value={server.mem} />
				<MetricBar label={t("healthPage.ui.disk")} value={server.diskMax} />
			</div>

			<div className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-[var(--border-subtle)] px-4 py-3 text-[11px]">
				<div className="flex justify-between gap-2">
					<span className="text-[var(--text-muted)]">{t("healthPage.ui.uptime")}</span>
					<span className="truncate font-medium text-[var(--text-secondary)]">
						{server.uptime ?? "—"}
					</span>
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
			</div>

			{server.error ? (
				<p className="border-t border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-2 text-[11px] text-[var(--danger)]">
					{server.error}
				</p>
			) : null}

			<div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-4 py-2">
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
					className="text-[11px] font-medium text-[var(--text-muted)] transition hover:text-[var(--text-secondary)]"
				>
					{expanded ? t("healthPage.ui.collapse") : t("healthPage.ui.trend")}
				</button>
			</div>

			{expanded ? (
				<div className="border-t border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3">
					{historyError ? (
						<div
							role="alert"
							className="rounded-lg border border-[var(--danger-border)] p-2 text-xs text-[var(--danger)]"
						>
							{historyError}
						</div>
					) : history ? (
						<SparklineChartLazy data={history} locale={locale} />
					) : (
						<div className="h-16 animate-pulse rounded-lg bg-[var(--surface)]" />
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
		autoRefresh,
		refreshIntervalSeconds,
		fetchHealth,
		fetchHistory,
		setAutoRefresh,
	} = useHealthData({ browserLocale, locale, mode: "vps" });

	const [expandedServer, setExpandedServer] = useState<string | null>(null);
	const [filter, setFilter] = useState<"all" | "online" | "issue">("all");

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
				<SummaryCard
					label={t("healthPage.summary.online")}
					value={overview?.online ?? "—"}
					color="emerald"
				/>
				<SummaryCard
					label={t("healthPage.summary.warning")}
					value={overview?.warning ?? "—"}
					color="amber"
				/>
				<SummaryCard
					label={t("healthPage.summary.critical")}
					value={overview?.critical ?? "—"}
					color="rose"
				/>
				<SummaryCard
					label={t("healthPage.summary.offline")}
					value={overview?.offline ?? "—"}
					color="slate"
				/>
			</section>

			{overview && overview.servers.length > 0 ? (
				<FleetResourceSummary overview={overview} t={t} tt={tt} />
			) : null}

			<CapacityForecastPanel />

			{/* toolbar — Komari-like header strip */}
			<div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 sm:flex-row sm:items-center sm:justify-between">
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
									? "bg-[var(--color-action)] text-white"
									: "bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
							}`}
						>
							{label}
						</button>
					))}
					<span className="ml-1 text-xs text-[var(--text-muted)]">
						{tt("vpsStatusPage.showing", { count: filteredServers.length })}
					</span>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<span className="text-xs text-[var(--text-muted)]">
						{t("healthPage.ui.lastRefresh")}: {lastRefresh || "—"}
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
						{isRefreshing || loading
							? t("healthPage.ui.refreshing")
							: t("healthPage.ui.refresh")}
					</button>
					<label className="flex min-h-11 items-center gap-2 text-xs text-[var(--text-secondary)]">
						<span>{t("healthPage.ui.autoRefresh")}</span>
						<button
							type="button"
							onClick={() => setAutoRefresh(!autoRefresh)}
							disabled={refreshIntervalSeconds <= 0}
							className={`relative h-4 w-8 min-h-11 min-w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${autoRefresh ? "bg-[var(--color-action)]" : "bg-[var(--surface)]"}`}
						>
							<span
								className={`absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--text-primary)] shadow transition-transform ${autoRefresh ? "translate-x-2" : "-translate-x-3"}`}
							/>
						</button>
						<span>
							{refreshIntervalSeconds <= 0
								? t("healthPage.ui.autoRefreshOff")
								: autoRefresh
									? tt("healthPage.ui.autoRefreshEvery", {
											label: getRefreshIntervalLabel(refreshIntervalSeconds),
										})
									: tt("healthPage.ui.autoRefreshPaused", {
											label: getRefreshIntervalLabel(refreshIntervalSeconds),
										})}
						</span>
					</label>
				</div>
			</div>

			{loading ? (
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
					{Array.from({ length: Math.min(Math.max(serverCount, 1), 8) }).map((_, i) => (
						<div
							key={i}
							className="h-56 animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
						/>
					))}
				</div>
			) : filteredServers.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-muted)]">
					{t("vpsStatusPage.empty")}
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

			<p className="text-center text-[11px] text-[var(--text-muted)]">
				{t("vpsStatusPage.agentNote")}
			</p>
		</div>
	);
}

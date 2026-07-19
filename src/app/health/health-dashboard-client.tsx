"use client";

import { useState } from "react";
import Link from "next/link";

import { toDateLocale } from "@/lib/i18n/locale-format";
import { useI18n } from "@/lib/i18n/use-locale";
import { getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";

import { ActiveIncidentsBanner } from "./active-incidents-banner";
import { CapacityForecastPanel } from "./capacity-forecast-panel";
import {
	repairSuggestions,
	repairToneClasses,
	statusLabelKey,
	statusToneClasses,
	tt as applyTemplate,
	unknownTone,
} from "./health-dashboard-helpers";
import { FleetResourceSummary, SummaryCard, UsageCell } from "./health-dashboard-parts";
import type { SystemHealthReport } from "./health-types";
import { SparklineChartLazy } from "./sparkline-chart-lazy";
import { useHealthData } from "./use-health-data";

type Props = { serverCount: number; initialSystemHealth?: SystemHealthReport | null };

export function HealthDashboardClient({ serverCount, initialSystemHealth }: Props) {
	const { locale, t } = useI18n();
	const browserLocale = toDateLocale(locale);
	const {
		overview,
		systemHealth,
		history,
		historyErrors,
		loadError,
		lastRefresh,
		isRefreshing,
		autoRefresh,
		refreshIntervalSeconds,
		fetchHealth,
		fetchSystemHealth: _fetchSystemHealth,
		fetchHistory,
		setAutoRefresh,
	} = useHealthData({ initialSystemHealth, browserLocale, locale });
	const loading = overview === null && loadError === null;
	const [expandedServer, setExpandedServer] = useState<string | null>(null);

	const toggleExpand = async (serverId: string) => {
		if (expandedServer === serverId) {
			setExpandedServer(null);
		} else {
			setExpandedServer(serverId);
			if (!history[serverId]) await fetchHistory(serverId);
		}
	};

	const tt = (key: string, vars?: Record<string, string | number>) => applyTemplate(t, key, vars);

	if (loading) {
		const skeletonRowCount = Math.min(Math.max(serverCount, 1), 8);
		return (
			<div className="space-y-6" aria-busy="true" aria-live="polite">
				<section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-label={t("healthPage.ui.selfCheck")}>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="min-w-0">
							<p className="text-xs uppercase tracking-[0.25em] text-[var(--text-muted)]">{t("healthPage.ui.selfCheck")}</p>
							<h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{t("healthPage.ui.repairSuggestions")}</h2>
							<p className="mt-1 text-xs text-[var(--text-secondary)]">{t("healthPage.ui.collectingMetrics")}</p>
						</div>
					</div>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{[1, 2, 3].map((i) => (
							<div key={i} className="h-24 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" />
						))}
					</div>
				</section>
				<section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
					<SummaryCard label={t("healthPage.summary.total")} value={serverCount > 0 ? serverCount : "—"} color="slate" />
					<SummaryCard label={t("healthPage.summary.online")} value="—" color="emerald" />
					<SummaryCard label={t("healthPage.summary.warning")} value="—" color="amber" />
					<SummaryCard label={t("healthPage.summary.critical")} value="—" color="rose" />
					<SummaryCard label={t("healthPage.summary.offline")} value="—" color="slate" />
				</section>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="text-xs text-[var(--text-muted)]">{t("healthPage.ui.lastRefresh")}: —</div>
					<div className="flex flex-wrap items-center gap-3">
						<button type="button" disabled data-action-button data-variant="secondary" className="inline-flex min-h-11 items-center !px-3 !text-xs opacity-60">
							{t("healthPage.ui.refreshing")}
						</button>
					</div>
				</div>
				<section data-card className="overflow-hidden">
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-[var(--border)] bg-[var(--surface-elevated)]">
									<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t("healthPage.ui.node")}</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t("healthPage.ui.status")}</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">CPU</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t("healthPage.ui.memory")}</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t("healthPage.ui.disk")}</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t("healthPage.ui.uptime")}</th>
									<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t("healthPage.ui.details")}</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-[var(--border-subtle)]">
								{Array.from({ length: skeletonRowCount }).map((_, i) => (
									<tr key={i} className="animate-pulse">
										<td className="px-4 py-4"><div className="h-3 w-32 rounded-lg bg-[var(--surface-elevated)]" /></td>
										<td className="px-4 py-4"><div className="h-3 w-12 rounded-lg bg-[var(--surface-elevated)]" /></td>
										<td className="px-4 py-4"><div className="h-3 w-16 rounded-lg bg-[var(--surface-elevated)]" /></td>
										<td className="px-4 py-4"><div className="h-3 w-16 rounded-lg bg-[var(--surface-elevated)]" /></td>
										<td className="px-4 py-4"><div className="h-3 w-16 rounded-lg bg-[var(--surface-elevated)]" /></td>
										<td className="px-4 py-4"><div className="h-3 w-20 rounded-lg bg-[var(--surface-elevated)]" /></td>
										<td className="px-4 py-4"><div className="h-3 w-8 rounded-lg bg-[var(--surface-elevated)]" /></td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			</div>
		);
	}

	if (!overview) {
		return (
			<div data-tone="rose" className="rounded-xl border border-[var(--danger-border)] p-4 text-sm text-[var(--danger)]" role="alert">
				<div>{loadError ?? t("healthPage.ui.healthUnavailable")}</div>
				<button
					type="button"
					onClick={fetchHealth}
					disabled={isRefreshing}
					data-action-button data-variant="danger" className="!mt-3 !px-3 !py-1.5 !text-xs disabled:cursor-not-allowed disabled:opacity-50"
				>
					{isRefreshing ? t("healthPage.ui.retrying") : t("healthPage.ui.retryLoad")}
				</button>
			</div>
		);
	}

	const { total, online, warning, critical, offline } = overview;

	return (
		<div className="space-y-6">
			<ActiveIncidentsBanner />
			{loadError && (
				<div role="alert" data-tone="rose" className="rounded-xl border border-[var(--danger-border)] p-3 text-sm text-[var(--danger)]">
					{loadError}
				</div>
			)}
			{systemHealth && (
				<section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="min-w-0">
							<p className="text-xs uppercase tracking-[0.25em] text-[var(--text-muted)]">{t("healthPage.ui.selfCheck")}</p>
							<h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{t("healthPage.ui.repairSuggestions")}</h2>
							<p className="mt-1 text-xs text-[var(--text-secondary)]">{tt("healthPage.ui.checksSummary", systemHealth.summary)}</p>
						</div>
						<div className="flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">
							<Link href="/audit" data-action-button data-variant="secondary" className="!px-3 !py-1.5 !text-xs">{t("healthPage.ui.auditLog")}</Link>
							<Link href="/" data-action-button data-variant="secondary" className="!px-3 !py-1.5 !text-xs">{t("healthPage.ui.home")}</Link>
						</div>
					</div>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{repairSuggestions(systemHealth.summary, t).map((item) => {
							const tone = repairToneClasses[item.status];
							return (
								<article key={item.id} className={`rounded-xl border p-4 ${tone.border} ${tone.bg}`}>
									<div className="flex items-center justify-between gap-3">
										<h3 className="text-sm font-semibold text-[var(--text-primary)]">{item.label}</h3>
										<span className={`rounded-full border px-2 py-0.5 text-[10px] ${tone.badge}`}>{item.status}</span>
									</div>
									<p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{item.description}</p>
									<p className="mt-3 text-xs text-[var(--text-secondary)]">
										{t("healthPage.ui.suggestedAction")}
										{item.href ? (
											<Link href={item.href} className="text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">
												{item.action}
											</Link>
										) : (
											item.action
										)}
									</p>
								</article>
							);
						})}
					</div>
					<div className="grid gap-2 md:grid-cols-2">
						{systemHealth.checks.map((check) => {
							const sc = statusToneClasses[check.status] ?? unknownTone;
							return (
								<div key={check.id} className={`rounded-xl border p-3 ${sc.bg}`}>
									<div className="flex items-center justify-between gap-3">
										<div className="text-sm font-medium text-[var(--text-primary)]">
											{tt(`healthPage.check.${check.id.startsWith("dir-") ? "dir" : check.id}.label`, check.params)}
										</div>
										<span className={`rounded-full border px-2 py-0.5 text-[10px] ${sc.text}`}>{t(statusLabelKey(check.status))}</span>
									</div>
									<p className="mt-1 text-xs text-[var(--text-secondary)]">
										{tt(`healthPage.check.${check.id.startsWith("dir-") ? "dir" : check.id}.message.${check.messageCode ?? check.status}`, check.params)}
									</p>
									{check.detail && <p className="mt-1 break-all text-[11px] text-[var(--text-muted)]">{check.detail}</p>}
								</div>
							);
						})}
					</div>
				</section>
			)}

			<section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
				<SummaryCard label={t("healthPage.summary.total")} value={total} color="slate" />
				<SummaryCard label={t("healthPage.summary.online")} value={online} color="emerald" />
				<SummaryCard label={t("healthPage.summary.warning")} value={warning} color="amber" />
				<SummaryCard label={t("healthPage.summary.critical")} value={critical} color="rose" />
				<SummaryCard label={t("healthPage.summary.offline")} value={offline} color="slate" />
			</section>
			{overview.servers.length > 0 && <FleetResourceSummary overview={overview} t={t} tt={tt} />}
			<CapacityForecastPanel />
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="text-xs text-[var(--text-muted)]">
					{t("healthPage.ui.lastRefresh")}: {lastRefresh || "—"}
					{overview.critical > 0
						? ` · ${t("healthPage.ui.overallCritical")}`
						: overview.warning > 0
							? ` · ${t("healthPage.ui.overallWarning")}`
							: ` · ${t("healthPage.ui.overallHealthy")}`}
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<button
						type="button"
						onClick={fetchHealth}
						disabled={isRefreshing}
						aria-label={t("healthPage.ui.refreshAria")}
					 data-action-button data-variant="secondary" className="inline-flex min-h-11 items-center !px-3 !text-xs disabled:cursor-not-allowed disabled:opacity-60">
						{isRefreshing ? t("healthPage.ui.refreshing") : t("healthPage.ui.refresh")}
					</button>
					<label className="flex min-h-11 items-center gap-2 text-xs text-[var(--text-secondary)]">
						<span>{t("healthPage.ui.autoRefresh")}</span>
						<button
							type="button"
							onClick={() => setAutoRefresh(!autoRefresh)}
							disabled={refreshIntervalSeconds <= 0}
							aria-label={t("healthPage.ui.toggleAutoRefreshAria")}
							className={`relative h-4 w-8 min-h-11 min-w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${autoRefresh ? "bg-[var(--color-action)]" : "bg-[var(--surface)]"}`}
						>
							<span className={`absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--text-primary)] shadow transition-transform ${autoRefresh ? "translate-x-2" : "-translate-x-3"}`} />
						</button>
						<span>
							{refreshIntervalSeconds <= 0
								? t("healthPage.ui.autoRefreshOff")
								: autoRefresh
									? tt("healthPage.ui.autoRefreshEvery", { label: getRefreshIntervalLabel(refreshIntervalSeconds) })
									: tt("healthPage.ui.autoRefreshPaused", { label: getRefreshIntervalLabel(refreshIntervalSeconds) })}
						</span>
					</label>
				</div>
			</div>

			<section data-card className="overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-[var(--border)] bg-[var(--surface-elevated)]">
								<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t("healthPage.ui.node")}</th>
								<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t("healthPage.ui.status")}</th>
								<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">CPU</th>
								<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t("healthPage.ui.memory")}</th>
								<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t("healthPage.ui.disk")}</th>
								<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t("healthPage.ui.uptime")}</th>
								<th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t("healthPage.ui.details")}</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-[var(--border-subtle)]">
							{overview.servers.map((server) => {
								const sc = statusToneClasses[server.status] ?? unknownTone;
								return (
									<tr key={server.serverId} className={`transition hover:bg-[var(--surface-elevated)] ${server.status === "critical" ? "bg-[var(--danger-bg)]" : ""}`}>
										<td className="px-4 py-3">
											<div className="flex items-center gap-2">
												<div className={`h-2 w-2 shrink-0 rounded-full ${sc.dot}`} />
												<div>
													<div className="font-medium text-[var(--text-primary)]">{server.serverName}</div>
													<div className="text-[11px] text-[var(--text-muted)]">{server.host}</div>
												</div>
											</div>
										</td>
										<td className="px-4 py-3">
											<span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${sc.bg} ${sc.text}`}>
												{t(statusLabelKey(server.status))}
											</span>
										</td>
										<td className="px-4 py-3"><UsageCell value={server.cpu} /></td>
										<td className="px-4 py-3"><UsageCell value={server.mem} /></td>
										<td className="px-4 py-3"><UsageCell value={server.diskMax} /></td>
										<td className="px-4 py-3 text-xs text-[var(--text-muted)]">{server.uptime ?? "—"}</td>
										<td className="px-4 py-3">
											<button
												type="button"
												onClick={() => toggleExpand(server.serverId)}
												className="text-[11px] text-[var(--text-muted)] transition hover:text-[var(--text-secondary)]"
											>
												{expandedServer === server.serverId ? t("healthPage.ui.collapse") : t("healthPage.ui.trend")}
											</button>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</section>

			{expandedServer && (history[expandedServer] || historyErrors[expandedServer]) && (
				<section data-card>
					<h3 className="mb-4 text-sm font-medium text-[var(--text-secondary)]">
						{tt("healthPage.ui.trendHeading", {
							name: overview.servers.find((s) => s.serverId === expandedServer)?.serverName ?? "",
						})}
					</h3>
					{historyErrors[expandedServer] ? (
						<div role="alert" data-tone="rose" className="rounded-lg border border-[var(--danger-border)] p-3 text-sm text-[var(--danger)]">
							{historyErrors[expandedServer]}
						</div>
					) : (
						<SparklineChartLazy data={history[expandedServer] ?? []} locale={locale} />
					)}
				</section>
			)}
		</div>
	);
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/use-locale";
import { getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";

import { useHealthData } from "./use-health-data";
import { ActiveIncidentsBanner } from "./active-incidents-banner";
import type { SystemHealthReport } from "./health-types";
import { SparklineChartLazy } from "./sparkline-chart-lazy";

type SystemHealthStatus = "healthy" | "warning" | "critical";
type SystemHealthSummary = { total: number; healthy: number; warning: number; critical: number; overall: SystemHealthStatus };

type Props = { serverCount: number; initialSystemHealth?: SystemHealthReport | null };

/**
 * Translates server-returned Chinese health-check labels/messages to English.
 * The server-side health check returns Chinese strings (it doesn't know the
 * client locale), so we translate them client-side via regex matching.
 */
function translateSystemHealthText(value: string, locale: "zh" | "en") {
	if (locale !== "en") return value;
	return value
		.replace(/^数据库连接$/, "Database Connection")
		.replace(/^数据库可查询$/, "Database is queryable")
		.replace(/^数据库不可用$/, "Database is unavailable")
		.replace(/^VPS 节点资产$/, "VPS Node Inventory")
		.replace(/^已纳管 (\d+) 个 VPS 节点$/, "Managed $1 VPS nodes")
		.replace(/^无法读取 VPS 节点$/, "Unable to read VPS nodes")
		.replace(/^云盘存储节点$/, "Cloud Storage Nodes")
		.replace(/^已配置 (\d+) 个存储节点$/, "Configured $1 storage nodes")
		.replace(/^尚未配置存储节点$/, "No storage nodes configured")
		.replace(/^运行目录基线$/, "Runtime Directory Baseline")
		.replace(/^(\d+)\/(\d+) 个运行目录可用$/, "$1/$2 runtime directories available")
		.replace(/^运行目录 (.+)$/, "Runtime directory $1")
		.replace(/^目录存在$/, "Directory exists")
		.replace(/^目录不存在，部署脚本会自动创建$/, "Directory is missing; deployment scripts will create it automatically")
		.replace(/^Next\.js 服务$/, "Next.js Service")
		.replace(/^SSH WebSocket 服务$/, "SSH WebSocket Service")
		.replace(/^Caddy 反代服务$/, "Caddy Reverse Proxy Service")
		.replace(/^(.+\.service) 正在运行$/, "$1 is running")
		.replace(/^(.+\.service) 当前状态为 (.+)$/, "$1 is currently $2")
		.replace(/^(.+\.service) 状态暂不可读$/, "$1 status is temporarily unreadable")
		.replace(/^数据库环境变量$/, "Database Environment Variable")
		.replace(/^DATABASE_URL 已配置$/, "DATABASE_URL is configured")
		.replace(/^DATABASE_URL 未配置或仍是占位符$/, "DATABASE_URL is missing or still a placeholder")
		.replace(/^通知渠道配置$/, "Notification Channel Configuration")
		.replace(/^已保存 (\d+) 项通知渠道配置$/, "Saved $1 notification channel settings")
		.replace(/^可在系统设置中配置通知渠道$/, "Configure notification channels in Settings")
		.replace(/^GitHub 同步状态$/, "GitHub Sync Status")
		.replace(/^本地提交 ([a-f0-9]+) 与 origin\/main 一致$/, "Local commit $1 matches origin/main")
		.replace(/^本地 ([a-f0-9]+) 与 origin\/main ([a-f0-9]+) 不一致$/, "Local $1 differs from origin/main $2")
		.replace(/^当前提交 ([a-f0-9]+)，远端状态暂不可确认$/, "Current commit $1; remote status is temporarily unavailable")
		.replace(/^当前目录不是可识别的 Git 仓库或无法读取 HEAD$/, "Current directory is not a recognized Git repository or HEAD cannot be read");
}

type RepairSuggestion = {
	id: string;
	label: string;
	description: string;
	descriptionCritical?: string;
	descriptionWarning?: string;
	action: string;
	status: SystemHealthStatus;
	href?: string;
};

type TFunc = (key: string) => string;

const repairSuggestions = (summary: SystemHealthSummary | null | undefined, t: TFunc): RepairSuggestion[] => {
	if (!summary) return [];
	return [
		{
			id: "db",
			label: t("healthPage.repair.db.label"),
			action: t("healthPage.repair.db.action"),
			description: summary.critical > 0
				? t("healthPage.repair.db.descriptionCritical")
				: t("healthPage.repair.db.description"),
			status: summary.critical > 0 ? "critical" : "healthy",
		},
		{
			id: "runtime",
			label: t("healthPage.repair.runtime.label"),
			action: t("healthPage.repair.runtime.action"),
			description: summary.warning > 0
				? t("healthPage.repair.runtime.descriptionWarning")
				: t("healthPage.repair.runtime.description"),
			status: summary.warning > 0 ? "warning" : "healthy",
		},
		{
			id: "services",
			label: t("healthPage.repair.services.label"),
			action: t("healthPage.repair.services.action"),
			description: summary.critical > 0
				? t("healthPage.repair.services.descriptionCritical")
				: t("healthPage.repair.services.description"),
			status: summary.critical > 0 ? "critical" : "healthy",
		},
		{
			id: "git",
			label: t("healthPage.repair.git.label"),
			action: t("healthPage.repair.git.action"),
			description: summary.warning > 0
				? t("healthPage.repair.git.descriptionWarning")
				: t("healthPage.repair.git.description"),
			status: summary.warning > 0 ? "warning" : "healthy",
		},
		{
			id: "audit",
			label: t("healthPage.repair.audit.label"),
			action: t("healthPage.repair.audit.action"),
			description: summary.critical > 0
				? t("healthPage.repair.audit.descriptionCritical")
				: t("healthPage.repair.audit.description"),
			href: "/audit?action=command.execute",
			status: summary.critical > 0 ? "critical" : "warning",
		},
	];
};

const repairToneClasses: Record<SystemHealthStatus, { border: string; bg: string; badge: string }> = {
	healthy: { border: "border-emerald-400/20", bg: "bg-emerald-400/10", badge: "border-emerald-400/30 text-emerald-100" },
	warning: { border: "border-amber-400/20", bg: "bg-amber-400/10", badge: "border-amber-400/30 text-amber-100" },
	critical: { border: "border-rose-400/20", bg: "bg-rose-400/10", badge: "border-rose-400/30 text-rose-100" },
};


/* ── Status helpers ───────────────────────────────────────── */

const statusToneClasses: Record<string, { bg: string; text: string; dot: string }> = {
	healthy: { bg: "border-emerald-400/20 bg-emerald-400/10", text: "text-[var(--success)]", dot: "bg-emerald-400" },
	warning: { bg: "border-amber-400/20 bg-amber-400/10", text: "text-[var(--warning)]", dot: "bg-amber-400" },
	critical: { bg: "border-rose-400/20 bg-rose-400/10", text: "text-[var(--danger)]", dot: "bg-rose-400" },
	offline: { bg: "border-slate-400/20 bg-slate-400/10", text: "text-[var(--text-secondary)]", dot: "bg-slate-500" },
	unknown: { bg: "border-slate-400/20 bg-slate-400/10", text: "text-[var(--text-secondary)]", dot: "bg-slate-600" },
};
const unknownTone = statusToneClasses.unknown!;

function usageColor(val: number | undefined, warn = 80, crit = 95): string {
	if (val === undefined) return "text-[var(--text-muted)]";
	if (val >= crit) return "text-rose-300";
	if (val >= warn) return "text-amber-300";
	return "text-emerald-300";
}

function usageBarColor(val: number | undefined, warn = 80, crit = 95): string {
	if (val === undefined) return "bg-[var(--surface)]";
	if (val >= crit) return "bg-rose-500";
	if (val >= warn) return "bg-amber-500";
	return "bg-emerald-500";
}

/* ── Component ────────────────────────────────────────────── */

export function HealthDashboardClient({ serverCount, initialSystemHealth }: Props) {
	const { locale, t } = useI18n();
	const browserLocale = locale === "zh" ? "zh-CN" : "en-US";
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
		// fetchSystemHealth 由 hook 内部 effect 自动触发（mount + auto-refresh），
		// 组件自身不再直接调用，所以解构后用 _ 前缀符合项目 lint 规范。
		fetchSystemHealth: _fetchSystemHealth,
		fetchHistory,
		setAutoRefresh,
	} = useHealthData({ initialSystemHealth, browserLocale, locale });
	// Loading skeleton is shown until the first fetchHealth attempt completes
	// (either with a result or with an error). The previous component
	// implemented this with an explicit `loading` boolean that flipped in
	// fetchHealth's `finally`; here we derive it from hook state.
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

	/** Template-string helper: replaces {placeholder} tokens in t() output. */
	const tt = (key: string, vars?: Record<string, string | number>) => {
		let s = t(key);
		if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
		return s;
	};

	if (loading) {
		// 骨架立即渲染：5 个概览卡用 "—" 占位 + 节点表骨架行（按 serverCount 数量）+ 系统自检骨架。
		// 概览数据由 /api/health 拉到后替换；自检数据由 /api/system-health 拉到后替换。
		const skeletonRowCount = Math.min(Math.max(serverCount, 1), 8);
		return (
			<div className="space-y-6" aria-busy="true" aria-live="polite">
				{/* 系统自检骨架卡 */}
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
							<div key={i} className="animate-pulse rounded-xl border border-white/[0.10] bg-[var(--surface)] p-4 h-24" />
						))}
					</div>
				</section>
				{/* 概览数字卡（5 列）— 立即出现，数字位用 — 占位 */}
				<section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
					<SummaryCard label={t("healthPage.summary.total")} value={serverCount > 0 ? serverCount : "—"} color="slate" />
					<SummaryCard label={t("healthPage.summary.online")} value="—" color="emerald" />
					<SummaryCard label={t("healthPage.summary.warning")} value="—" color="amber" />
					<SummaryCard label={t("healthPage.summary.critical")} value="—" color="rose" />
					<SummaryCard label={t("healthPage.summary.offline")} value="—" color="slate" />
				</section>
				{/* 工具行 — 占位但禁用刷新按钮 */}
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="text-xs text-[var(--text-muted)]">{t("healthPage.ui.lastRefresh")}: —</div>
					<div className="flex flex-wrap items-center gap-3">
						<button type="button" disabled className="min-h-11 inline-flex items-center rounded-lg border border-white/[0.10] bg-[var(--surface)] px-3 text-xs text-[var(--text-muted)] opacity-60">
							{t("healthPage.ui.refreshing")}
						</button>
					</div>
				</div>
				{/* 节点表骨架（表头 + 按 serverCount 数量的骨架行） */}
				<section data-card className="overflow-hidden">
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-white/[0.10] bg-[var(--surface)]">
									<th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">{t("healthPage.ui.node")}</th>
									<th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">{t("healthPage.ui.status")}</th>
									<th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">CPU</th>
									<th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">{t("healthPage.ui.memory")}</th>
									<th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">{t("healthPage.ui.disk")}</th>
									<th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">{t("healthPage.ui.uptime")}</th>
									<th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">{t("healthPage.ui.details")}</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-white/[0.04] light:divide-slate-200">
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
			<div data-tone="rose" className="rounded-xl border border-rose-400/20 p-4 text-sm text-rose-100" role="alert">
				<div>{loadError ?? t("healthPage.ui.healthUnavailable")}</div>
				<button
					type="button"
					onClick={fetchHealth}
					disabled={isRefreshing}
					className="mt-3 rounded-lg border border-rose-300/40 px-3 py-1.5 text-xs transition hover:bg-rose-300/10 disabled:cursor-not-allowed disabled:opacity-60"
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
				<div role="alert" data-tone="rose" className="rounded-xl border border-rose-400/20 p-3 text-sm text-rose-100">
					{loadError}
				</div>
			)}
			{systemHealth && (
				<>
					<section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="min-w-0">
						<p className="text-xs uppercase tracking-[0.25em] text-[var(--text-muted)]">{t("healthPage.ui.selfCheck")}</p>
						<h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{t("healthPage.ui.repairSuggestions")}</h2>
						<p className="mt-1 text-xs text-[var(--text-secondary)]">
							{tt("healthPage.ui.checksSummary", systemHealth.summary)}
						</p>
					</div>
					<div className="flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">
						<Link href="/audit" className="min-h-11 inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 transition hover:bg-[var(--sidebar-hover)]">{t("healthPage.ui.auditLog")}</Link>
						<Link href="/" className="min-h-11 inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 transition hover:bg-[var(--sidebar-hover)]">{t("healthPage.ui.home")}</Link>
					</div>
					</div>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{repairSuggestions(systemHealth.summary, t).map((item) => {
								const tone = repairToneClasses[item.status];
								return (
									<article key={item.id} className={`rounded-xl border ${tone.border} ${tone.bg} p-4`}>
										<div className="flex items-center justify-between gap-3">
											<h3 className="text-sm font-semibold text-[var(--text-primary)]">{item.label}</h3>
											<span className={`rounded-full border px-2 py-0.5 text-[10px] ${tone.badge}`}>{item.status}</span>
										</div>
										<p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{item.description}</p>
										<p className="mt-3 text-xs text-[var(--text-secondary)]">{t("healthPage.ui.suggestedAction")}{item.href ? <Link href={item.href} className="text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">{item.action}</Link> : item.action}</p>
									</article>
								);
							})}
						</div>
						<div className="grid gap-2 md:grid-cols-2">
							{systemHealth.checks.map((check) => {
								const sc = statusToneClasses[check.status] ?? unknownTone;
								return (
									<div key={check.id} className={`rounded-xl border ${sc.bg} p-3`}>
										<div className="flex items-center justify-between gap-3">
											<div className="text-sm font-medium text-[var(--text-primary)]">{translateSystemHealthText(check.label, locale)}</div>
											<span className={`rounded-full border px-2 py-0.5 text-[10px] ${sc.text}`}>{t("healthPage.status." + check.status)}</span>
										</div>
										<p className="mt-1 text-xs text-[var(--text-secondary)]">{translateSystemHealthText(check.message, locale)}</p>
										{check.detail && <p className="mt-1 break-all text-[11px] text-[var(--text-muted)]">{translateSystemHealthText(check.detail, locale)}</p>}
									</div>
								);
							})}
						</div>
					</section>
				</>
			)}

			<section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
				<SummaryCard label={t("healthPage.summary.total")} value={total} color="slate" />
				<SummaryCard label={t("healthPage.summary.online")} value={online} color="emerald" />
				<SummaryCard label={t("healthPage.summary.warning")} value={warning} color="amber" />
				<SummaryCard label={t("healthPage.summary.critical")} value={critical} color="rose" />
				<SummaryCard label={t("healthPage.summary.offline")} value={offline} color="slate" />
			</section>
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="text-xs text-[var(--text-muted)]">
					{t("healthPage.ui.lastRefresh")}: {lastRefresh || "—"}
					{overview.critical > 0 ? ` · ${t("healthPage.ui.overallCritical")}` : overview.warning > 0 ? ` · ${t("healthPage.ui.overallWarning")}` : ` · ${t("healthPage.ui.overallHealthy")}`}
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<button
						type="button"
						onClick={fetchHealth}
						disabled={isRefreshing}
						aria-label={t("healthPage.ui.refreshAria")}
						className="min-h-11 inline-flex items-center rounded-lg border border-white/[0.10] bg-[var(--surface)] px-3 text-xs text-[var(--text-secondary)] hover:bg-[var(--sidebar-hover)] transition disabled:cursor-not-allowed disabled:opacity-60"
					>
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
						<span>{refreshIntervalSeconds <= 0 ? t("healthPage.ui.autoRefreshOff") : autoRefresh ? tt("healthPage.ui.autoRefreshEvery", { label: getRefreshIntervalLabel(refreshIntervalSeconds) }) : tt("healthPage.ui.autoRefreshPaused", { label: getRefreshIntervalLabel(refreshIntervalSeconds) })}</span>
					</label>
				</div>
			</div>

			{/* Server table */}
			<section data-card className=" overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-white/[0.10] bg-[var(--surface)]">
								<th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">{t("healthPage.ui.node")}</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">{t("healthPage.ui.status")}</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">CPU</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">{t("healthPage.ui.memory")}</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">{t("healthPage.ui.disk")}</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">{t("healthPage.ui.uptime")}</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">{t("healthPage.ui.details")}</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-white/[0.04]">
							{overview.servers.map((server) => {
								const sc = statusToneClasses[server.status] ?? unknownTone;
								return (
									<tr key={server.serverId} className={`hover:bg-[var(--surface-elevated)] transition ${server.status === "critical" ? "bg-[var(--danger-bg)]" : ""}`}>
										<td className="px-4 py-3">
											<div className="flex items-center gap-2">
												<div className={`h-2 w-2 rounded-full ${sc.dot} shrink-0`} />
												<div>
													<div className="font-medium text-[var(--text-primary)]">{server.serverName}</div>
													<div className="text-[11px] text-[var(--text-muted)]">{server.host}</div>
												</div>
											</div>
										</td>
										<td className="px-4 py-3">
											<span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${sc.bg} ${sc.text}`}>
												{t("healthPage.status." + server.status)}
											</span>
										</td>
										<td className="px-4 py-3">
											<UsageCell value={server.cpu} />
										</td>
										<td className="px-4 py-3">
											<UsageCell value={server.mem} />
										</td>
										<td className="px-4 py-3">
											<UsageCell value={server.diskMax} />
										</td>
										<td className="px-4 py-3 text-xs text-[var(--text-muted)]">
											{server.uptime ?? "—"}
										</td>
										<td className="px-4 py-3">
											<button
												onClick={() => toggleExpand(server.serverId)}
												className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition"
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

			{/* Expanded trend section */}
			{expandedServer && (history[expandedServer] || historyErrors[expandedServer]) && (
				<section data-card className=" ">
					<h3 className="text-sm font-medium text-[var(--text-secondary)] mb-4">
						{tt("healthPage.ui.trendHeading", { name: overview.servers.find((s) => s.serverId === expandedServer)?.serverName ?? "" })}
					</h3>
					{historyErrors[expandedServer] ? (
						<div role="alert" data-tone="rose" className="rounded-lg border border-rose-400/20 p-3 text-sm text-rose-100">
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

/* ── Sub-components ───────────────────────────────────────── */

function SummaryCard({ label, value, color }: { label: string; value: number | string; color: string }) {
	const colorMap: Record<string, string> = {
		slate: "text-[var(--text-primary)]",
		emerald: "text-emerald-300",
		amber: "text-amber-300",
		rose: "text-rose-300",
	};
	return (
		<article data-card className=" p-4">
			<div className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">{label}</div>
			<div className={`mt-1.5 text-2xl sm:text-3xl font-semibold ${colorMap[color] ?? "text-[var(--text-primary)]"}`}>{value}</div>
		</article>
	);
}

function UsageCell({ value }: { value: number | undefined }) {
	if (value === undefined) return <span className="text-xs text-[var(--text-muted)]">—</span>;
	return (
		<div className="flex items-center gap-2 min-w-[100px]">
			<div className="flex-1 h-1.5 rounded-full bg-[var(--surface-hover)] overflow-hidden">
				<div className={`h-full rounded-full ${usageBarColor(value)} transition-[width]`} style={{ width: `${Math.min(100, value)}%` }} />
			</div>
			<span className={`text-xs font-mono tabular-nums w-12 text-right ${usageColor(value)}`}>
				{value.toFixed(1)}%
			</span>
		</div>
	);
}

/* ── Sparkline chart moved to ./sparkline-chart.tsx (TR-036 lazy load) ── */
// The SVG sparkline is now reachable via `./sparkline-chart-lazy` which
// wraps `next/dynamic` with a stub-loading placeholder. Keeping the
// component definition in a sibling file lets webpack split it into its
// own chunk so the trend expansion can fetch the SVG on first click
// instead of pulling it into the initial /health bundle.

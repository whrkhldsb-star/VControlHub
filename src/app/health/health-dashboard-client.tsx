"use client";

import { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/use-locale";
import { getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";

import { useHealthData } from "./use-health-data";
import type { MetricPoint, SystemHealthReport } from "./health-types";

type SystemHealthStatus = "healthy" | "warning" | "critical";
type SystemHealthSummary = { total: number; healthy: number; warning: number; critical: number; overall: SystemHealthStatus };

type ServerHealth = {
	serverId: string;
	serverName: string;
	host: string;
	enabled: boolean;
	status: "healthy" | "warning" | "critical" | "offline" | "unknown";
	cpu?: number;
	mem?: number;
	diskMax?: number;
	uptime?: string;
	lastCheck: string;
	error?: string;
};

type HealthOverview = {
	total: number; online: number; warning: number; critical: number; offline: number;
	servers: ServerHealth[];
};

type Props = { serverCount: number; initialSystemHealth?: SystemHealthReport | null };

type HealthCopy = {
	statusLabels: Record<string, string>;
	summaryCards: { total: string; online: string; warning: string; critical: string; offline: string };
	ui: {
		selfCheck: string;
		repairSuggestions: string;
		checksSummary: (summary: SystemHealthSummary) => string;
		auditLog: string;
		home: string;
		suggestedAction: string;
		lastRefresh: string;
		overallCritical: string;
		overallWarning: string;
		overallHealthy: string;
		refreshAria: string;
		refreshing: string;
		refresh: string;
		autoRefresh: string;
		toggleAutoRefreshAria: string;
		autoRefreshOff: string;
		autoRefreshEvery: (label: string) => string;
		autoRefreshPaused: (label: string) => string;
		healthUnavailable: string;
		retrying: string;
		retryLoad: string;
		node: string;
		status: string;
		memory: string;
		disk: string;
		uptime: string;
		details: string;
		collapse: string;
		trend: string;
		trendHeading: (name: string) => string;
	};
	repair: Record<string, Pick<RepairSuggestion, "label" | "description" | "action">>;
};

const healthCopy: Record<"zh" | "en", HealthCopy> = {
	zh: {
		statusLabels: { healthy: "正常", warning: "警告", critical: "严重", offline: "离线", unknown: "未知" },
		summaryCards: { total: "节点总数", online: "在线正常", warning: "性能警告", critical: "严重告警", offline: "离线/停用" },
		ui: {
			selfCheck: "系统自检",
			repairSuggestions: "修复建议",
			checksSummary: (summary) => `${summary.total} 项检查 · ${summary.healthy} 正常 · ${summary.warning} 警告 · ${summary.critical} 严重`,
			auditLog: "看审计日志",
			home: "回到首页",
			suggestedAction: "建议动作：",
			lastRefresh: "上次刷新",
			overallCritical: "有严重告警",
			overallWarning: "有警告项",
			overallHealthy: "当前整体正常",
			refreshAria: "刷新健康状态",
			refreshing: "正在刷新...",
			refresh: "🔄 刷新",
			autoRefresh: "自动刷新",
			toggleAutoRefreshAria: "切换健康状态自动刷新",
			autoRefreshOff: "已关闭",
			autoRefreshEvery: (label) => `每 ${label}`,
			autoRefreshPaused: (label) => `已暂停 · ${label}`,
			healthUnavailable: "健康状态暂不可用",
			retrying: "正在重试...",
			retryLoad: "重试加载健康状态",
			node: "节点",
			status: "状态",
			memory: "内存",
			disk: "磁盘",
			uptime: "运行时间",
			details: "详情",
			collapse: "收起 ▲",
			trend: "趋势 ▼",
			trendHeading: (name) => `${name} — 过去 24h 趋势`,
		},
		repair: {
			db: {
				label: "检查数据库连接",
				description: "数据库状态正常，可继续关注业务层告警。",
				action: "验证 DATABASE_URL、数据库进程和 Prisma 连接",
			},
			runtime: {
				label: "确认运行目录",
				description: "运行目录基线已就绪。",
				action: "检查 storage / uploads / downloads / backups / logs / tmp",
			},
			services: {
				label: "核对核心服务",
				description: "核心服务在线，可继续检查业务功能。",
				action: "验证 vcontrolhub-next.service / vcontrolhub-ssh-ws.service / caddy.service",
			},
			git: {
				label: "核对 GitHub 同步",
				description: "本地提交与 origin/main 保持一致。",
				action: "比对本地 HEAD 与 origin/main",
			},
			audit: {
				label: "复查审计高风险动作",
				description: "可快速查看最近的命令执行、删除、权限和令牌操作。",
				action: "查看 command.execute / storage.file_delete / api_token.create",
			},
		},
	},
	en: {
		statusLabels: { healthy: "Healthy", warning: "Warning", critical: "Critical", offline: "Offline", unknown: "Unknown" },
		summaryCards: { total: "Total Nodes", online: "Online Healthy", warning: "Performance Warnings", critical: "Critical Alerts", offline: "Offline/Disabled" },
		ui: {
			selfCheck: "System Self-check",
			repairSuggestions: "Repair Suggestions",
			checksSummary: (summary) => `${summary.total} checks · ${summary.healthy} healthy · ${summary.warning} warnings · ${summary.critical} critical`,
			auditLog: "View Audit Log",
			home: "Back Home",
			suggestedAction: "Suggested action: ",
			lastRefresh: "Last refresh",
			overallCritical: "critical alerts present",
			overallWarning: "warnings present",
			overallHealthy: "overall healthy",
			refreshAria: "Refresh health status",
			refreshing: "Refreshing...",
			refresh: "🔄 Refresh",
			autoRefresh: "Auto refresh",
			toggleAutoRefreshAria: "Toggle health auto refresh",
			autoRefreshOff: "Off",
			autoRefreshEvery: (label) => `Every ${label}`,
			autoRefreshPaused: (label) => `Paused · ${label}`,
			healthUnavailable: "Health status is temporarily unavailable",
			retrying: "Retrying...",
			retryLoad: "Retry loading health status",
			node: "Node",
			status: "Status",
			memory: "Memory",
			disk: "Disk",
			uptime: "Uptime",
			details: "Details",
			collapse: "Collapse ▲",
			trend: "Trend ▼",
			trendHeading: (name) => `${name} — last 24h trend`,
		},
		repair: {
			db: {
				label: "Check database connection",
				description: "Database checks are healthy; continue watching business-level alerts.",
				action: "Verify DATABASE_URL, database process, and Prisma connectivity",
			},
			runtime: {
				label: "Confirm runtime directories",
				description: "Runtime directory baseline is ready.",
				action: "Check storage / uploads / downloads / backups / logs / tmp",
			},
			services: {
				label: "Verify core services",
				description: "Core services are online; continue checking product workflows.",
				action: "Verify vcontrolhub-next.service / vcontrolhub-ssh-ws.service / caddy.service",
			},
			git: {
				label: "Check GitHub sync",
				description: "Local commits match origin/main.",
				action: "Compare local HEAD with origin/main",
			},
			audit: {
				label: "Review high-risk audit actions",
				description: "Quickly inspect recent command execution, deletion, permission, and token actions.",
				action: "Open command.execute / storage.file_delete / api_token.create",
			},
		},
	},
};

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
	action: string;
	status: SystemHealthStatus;
	href?: string;
};

const repairSuggestions = (summary: SystemHealthSummary | null | undefined, locale: "zh" | "en"): RepairSuggestion[] => {
	if (!summary) return [];
	const copy = healthCopy[locale];
	const zh = locale === "zh";
	return [
		{
			id: "db",
			...copy.repair.db,
			description: summary.critical > 0
				? zh ? "优先确认数据库与环境变量是否正常，必要时重载服务并检查日志。" : "First confirm the database and environment variables, then reload services and inspect logs if needed."
				: copy.repair.db.description,
			status: summary.critical > 0 ? "critical" : "healthy",
		},
		{
			id: "runtime",
			...copy.repair.runtime,
			description: summary.warning > 0
				? zh ? "部署目录或缓存目录可能缺失，建议补齐并复查权限。" : "Deployment or cache directories may be missing; create them and recheck ownership."
				: copy.repair.runtime.description,
			status: summary.warning > 0 ? "warning" : "healthy",
		},
		{
			id: "services",
			...copy.repair.services,
			description: summary.critical > 0
				? zh ? "优先确认 Next.js、SSH WS 与 Caddy 是否都在运行。" : "First confirm Next.js, SSH WS, and Caddy are all running."
				: copy.repair.services.description,
			status: summary.critical > 0 ? "critical" : "healthy",
		},
		{
			id: "git",
			...copy.repair.git,
			description: summary.warning > 0
				? zh ? "本地与远端可能不同步，建议确认最近推送是否完成。" : "Local and remote refs may differ; confirm the latest push completed."
				: copy.repair.git.description,
			status: summary.warning > 0 ? "warning" : "healthy",
		},
		{
			id: "audit",
			...copy.repair.audit,
			description: summary.critical > 0
				? zh ? "系统已经出现严重告警，建议结合审计页先锁定最近的高风险操作。" : "Critical alerts are present; use the audit page to identify recent high-risk operations first."
				: copy.repair.audit.description,
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
	healthy: { bg: "border-emerald-400/20 bg-emerald-400/10", text: "text-emerald-200", dot: "bg-emerald-400" },
	warning: { bg: "border-amber-400/20 bg-amber-400/10", text: "text-amber-200", dot: "bg-amber-400" },
	critical: { bg: "border-rose-400/20 bg-rose-400/10", text: "text-rose-200", dot: "bg-rose-400" },
	offline: { bg: "border-slate-400/20 bg-slate-400/10", text: "text-slate-200", dot: "bg-slate-500" },
	unknown: { bg: "border-slate-400/20 bg-slate-400/10", text: "text-slate-400", dot: "bg-slate-600" },
};

function usageColor(val: number | undefined, warn = 80, crit = 95): string {
	if (val === undefined) return "text-slate-600";
	if (val >= crit) return "text-rose-300";
	if (val >= warn) return "text-amber-300";
	return "text-emerald-300";
}

function usageBarColor(val: number | undefined, warn = 80, crit = 95): string {
	if (val === undefined) return "bg-slate-700";
	if (val >= crit) return "bg-rose-500";
	if (val >= warn) return "bg-amber-500";
	return "bg-emerald-500";
}

/* ── Component ────────────────────────────────────────────── */

export function HealthDashboardClient({ serverCount: _serverCount, initialSystemHealth }: Props) {
	void _serverCount;
	const { locale } = useI18n();
	const copy = healthCopy[locale];
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
		fetchSystemHealth,
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

	if (loading) {
		return (
			<div className="space-y-4">
				<div className="grid gap-3 sm:grid-cols-4">
					{[1,2,3,4].map((i) => (
						<div key={i} data-card className="animate-pulse  p-5 h-24" />
					))}
				</div>
			</div>
		);
	}

	if (!overview) {
		return (
			<div data-tone="rose" className="rounded-xl border border-rose-400/20 p-4 text-sm text-rose-100" role="alert">
				<div>{loadError ?? copy.ui.healthUnavailable}</div>
				<button
					type="button"
					onClick={fetchHealth}
					disabled={isRefreshing}
					className="mt-3 rounded-lg border border-rose-300/40 px-3 py-1.5 text-xs transition hover:bg-rose-300/10 disabled:cursor-not-allowed disabled:opacity-60"
				>
					{isRefreshing ? copy.ui.retrying : copy.ui.retryLoad}
				</button>
			</div>
		);
	}

	const { total, online, warning, critical, offline } = overview;

	return (
		<div className="space-y-6">
			{loadError && (
				<div role="alert" data-tone="rose" className="rounded-xl border border-rose-400/20 p-3 text-sm text-rose-100">
					{loadError}
				</div>
			)}
			{systemHealth && (
				<>
					<section className="space-y-3 rounded-2xl border border-[var(--border)] bg-white/[0.03] p-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0">
					<p className="text-xs uppercase tracking-[0.25em] text-cyan-300/70">{copy.ui.selfCheck}</p>
					<h2 className="mt-1 text-lg font-semibold text-white">{copy.ui.repairSuggestions}</h2>
					<p className="mt-1 text-xs text-slate-400">
						{copy.ui.checksSummary(systemHealth.summary)}
					</p>
				</div>
				<div className="flex flex-wrap gap-2 text-xs text-slate-400">
					<Link href="/audit" className="min-h-11 inline-flex items-center rounded-full border border-[var(--border)] bg-white/[0.03] px-3 transition hover:bg-white/[0.06]">{copy.ui.auditLog}</Link>
					<Link href="/" className="min-h-11 inline-flex items-center rounded-full border border-[var(--border)] bg-white/[0.03] px-3 transition hover:bg-white/[0.06]">{copy.ui.home}</Link>
				</div>
			</div>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{repairSuggestions(systemHealth.summary, locale).map((item) => {
								const tone = repairToneClasses[item.status];
								return (
									<article key={item.id} className={`rounded-xl border ${tone.border} ${tone.bg} p-4`}>
										<div className="flex items-center justify-between gap-3">
											<h3 className="text-sm font-semibold text-white">{item.label}</h3>
											<span className={`rounded-full border px-2 py-0.5 text-[10px] ${tone.badge}`}>{item.status}</span>
										</div>
										<p className="mt-2 text-sm leading-6 text-slate-300">{item.description}</p>
									<p className="mt-3 text-xs text-slate-400">{copy.ui.suggestedAction}{item.href ? <Link href={item.href} className="text-cyan-200 transition hover:text-cyan-100">{item.action}</Link> : item.action}</p>
								</article>
							);
						})}
						</div>
						<div className="grid gap-2 md:grid-cols-2">
							{systemHealth.checks.map((check) => {
								const sc = statusToneClasses[check.status] ?? statusToneClasses.unknown;
								return (
									<div key={check.id} className={`rounded-xl border ${sc.bg} p-3`}>
										<div className="flex items-center justify-between gap-3">
											<div className="text-sm font-medium text-white">{translateSystemHealthText(check.label, locale)}</div>
											<span className={`rounded-full border px-2 py-0.5 text-[10px] ${sc.text}`}>{copy.statusLabels[check.status] ?? check.status}</span>
										</div>
										<p className="mt-1 text-xs text-slate-300">{translateSystemHealthText(check.message, locale)}</p>
										{check.detail && <p className="mt-1 break-all text-[11px] text-slate-500">{translateSystemHealthText(check.detail, locale)}</p>}
									</div>
								);
							})}
						</div>
					</section>
				</>
			)}

			<section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
				<SummaryCard label={copy.summaryCards.total} value={total} color="slate" />
				<SummaryCard label={copy.summaryCards.online} value={online} color="emerald" />
				<SummaryCard label={copy.summaryCards.warning} value={warning} color="amber" />
				<SummaryCard label={copy.summaryCards.critical} value={critical} color="rose" />
				<SummaryCard label={copy.summaryCards.offline} value={offline} color="slate" />
			</section>
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="text-xs text-slate-500">
					{copy.ui.lastRefresh}: {lastRefresh || "—"}
					{overview.critical > 0 ? ` · ${copy.ui.overallCritical}` : overview.warning > 0 ? ` · ${copy.ui.overallWarning}` : ` · ${copy.ui.overallHealthy}`}
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<button
						type="button"
						onClick={fetchHealth}
						disabled={isRefreshing}
						aria-label={copy.ui.refreshAria}
						className="min-h-11 inline-flex items-center rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 text-xs text-slate-300 hover:bg-white/[0.06] transition disabled:cursor-not-allowed disabled:opacity-60"
					>
						{isRefreshing ? copy.ui.refreshing : copy.ui.refresh}
					</button>
					<label className="flex min-h-11 items-center gap-2 text-xs text-slate-400">
						<span>{copy.ui.autoRefresh}</span>
						<button
							type="button"
							onClick={() => setAutoRefresh(!autoRefresh)}
							disabled={refreshIntervalSeconds <= 0}
							aria-label={copy.ui.toggleAutoRefreshAria}
							className={`relative h-4 w-8 min-h-11 min-w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${autoRefresh ? "bg-cyan-500" : "bg-slate-700"}`}
						>
							<span className={`absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-transform ${autoRefresh ? "translate-x-2" : "-translate-x-3"}`} />
						</button>
						<span>{refreshIntervalSeconds <= 0 ? copy.ui.autoRefreshOff : autoRefresh ? copy.ui.autoRefreshEvery(getRefreshIntervalLabel(refreshIntervalSeconds)) : copy.ui.autoRefreshPaused(getRefreshIntervalLabel(refreshIntervalSeconds))}</span>
					</label>
				</div>
			</div>

			{/* Server table */}
			<section data-card className=" overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-white/[0.06] bg-white/[0.02]">
								<th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{copy.ui.node}</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{copy.ui.status}</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">CPU</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{copy.ui.memory}</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{copy.ui.disk}</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{copy.ui.uptime}</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{copy.ui.details}</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-white/[0.04]">
							{overview.servers.map((server) => {
								const sc = statusToneClasses[server.status] ?? statusToneClasses.unknown;
								return (
									<tr key={server.serverId} className={`hover:bg-white/[0.03] transition ${server.status === "critical" ? "bg-rose-500/[0.04]" : ""}`}>
										<td className="px-4 py-3">
											<div className="flex items-center gap-2">
												<div className={`h-2 w-2 rounded-full ${sc.dot} shrink-0`} />
												<div>
													<div className="font-medium text-white">{server.serverName}</div>
													<div className="text-[11px] text-slate-500">{server.host}</div>
												</div>
											</div>
										</td>
										<td className="px-4 py-3">
											<span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${sc.bg} ${sc.text}`}>
												{copy.statusLabels[server.status] ?? server.status}
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
										<td className="px-4 py-3 text-xs text-slate-500">
											{server.uptime ?? "—"}
										</td>
										<td className="px-4 py-3">
											<button
												onClick={() => toggleExpand(server.serverId)}
												className="text-[11px] text-cyan-400/70 hover:text-cyan-300 transition"
											>
												{expandedServer === server.serverId ? copy.ui.collapse : copy.ui.trend}
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
				<section data-card className=" p-5">
					<h3 className="text-sm font-medium text-white/80 mb-4">
						{copy.ui.trendHeading(overview.servers.find((s) => s.serverId === expandedServer)?.serverName ?? "")}
					</h3>
					{historyErrors[expandedServer] ? (
						<div role="alert" data-tone="rose" className="rounded-lg border border-rose-400/20 p-3 text-sm text-rose-100">
							{historyErrors[expandedServer]}
						</div>
					) : (
						<SparklineChart data={history[expandedServer] ?? []} locale={locale} />
					)}
				</section>
			)}
		</div>
	);
}

/* ── Sub-components ───────────────────────────────────────── */

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
	const colorMap: Record<string, string> = {
		slate: "text-white",
		emerald: "text-emerald-300",
		amber: "text-amber-300",
		rose: "text-rose-300",
	};
	return (
		<article data-card className=" p-4">
			<div className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</div>
			<div className={`mt-1.5 text-2xl sm:text-3xl font-semibold ${colorMap[color] ?? "text-white"}`}>{value}</div>
		</article>
	);
}

function UsageCell({ value }: { value: number | undefined }) {
	if (value === undefined) return <span className="text-xs text-slate-600">—</span>;
	return (
		<div className="flex items-center gap-2 min-w-[100px]">
			<div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
				<div className={`h-full rounded-full ${usageBarColor(value)} transition-all`} style={{ width: `${Math.min(100, value)}%` }} />
			</div>
			<span className={`text-xs font-mono tabular-nums w-12 text-right ${usageColor(value)}`}>
				{value.toFixed(1)}%
			</span>
		</div>
	);
}

/* ── Simple sparkline chart (SVG) ─────────────────────────── */

function SparklineChart({ data, locale }: { data: MetricPoint[]; locale: "zh" | "en" }) {
	const labels = locale === "zh" ? { memory: "内存", disk: "磁盘", localeCode: "zh-CN" } : { memory: "Memory", disk: "Disk", localeCode: "en-US" };
	if (data.length === 0) return <div className="text-xs text-slate-500">{locale === "zh" ? "暂无历史数据" : "No history data yet"}</div>;

	const W = 700;
	const H = 200;
	const padX = 40;
	const padY = 20;
	const plotW = W - padX * 2;
	const plotH = H - padY * 2;

	const maxVal = 100;
	const minTime = new Date(data[0].t).getTime();
	const maxTime = new Date(data[data.length - 1].t).getTime();
	const timeRange = maxTime - minTime || 1;

	const toX = (t: number) => padX + ((t - minTime) / timeRange) * plotW;
	const toY = (v: number) => padY + plotH - (v / maxVal) * plotH;

	const cpuPath = data.map((d, i) => `${i === 0 ? "M" : "L"} ${toX(new Date(d.t).getTime())} ${toY(d.cpu)}`).join(" ");
	const memPath = data.map((d, i) => `${i === 0 ? "M" : "L"} ${toX(new Date(d.t).getTime())} ${toY(d.mem)}`).join(" ");
	const diskPath = data.map((d, i) => `${i === 0 ? "M" : "L"} ${toX(new Date(d.t).getTime())} ${toY(d.disk)}`).join(" ");

	// Warning/Critical lines
	const warnY = toY(80);
	const critY = toY(95);

	return (
		<div className="overflow-x-auto">
			<svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[500px]" style={{ height: "auto" }}>
				{/* Grid lines */}
				<line x1={padX} y1={warnY} x2={W - padX} y2={warnY} stroke="rgba(251,191,36,0.2)" strokeWidth={1} strokeDasharray="4,4" />
				<line x1={padX} y1={critY} x2={W - padX} y2={critY} stroke="rgba(244,63,94,0.2)" strokeWidth={1} strokeDasharray="4,4" />
				<text x={padX - 4} y={warnY + 4} textAnchor="end" fill="rgba(251,191,36,0.5)" fontSize={9}>80%</text>
				<text x={padX - 4} y={critY + 4} textAnchor="end" fill="rgba(244,63,94,0.5)" fontSize={9}>95%</text>

				{/* Lines */}
				<path d={cpuPath} fill="none" stroke="#4ade80" strokeWidth={1.5} />
				<path d={memPath} fill="none" stroke="#60a5fa" strokeWidth={1.5} />
				<path d={diskPath} fill="none" stroke="#f59e0b" strokeWidth={1.5} />

				{/* Axis */}
				<line x1={padX} y1={H - padY} x2={W - padX} y2={H - padY} stroke="rgba(148,163,184,0.15)" strokeWidth={1} />
				<line x1={padX} y1={padY} x2={padX} y2={H - padY} stroke="rgba(148,163,184,0.15)" strokeWidth={1} />

				{/* Time labels */}
				{data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 6)) === 0).map((d) => (
					<text key={d.t} x={toX(new Date(d.t).getTime())} y={H - padY + 14} textAnchor="middle" fill="rgba(148,163,184,0.4)" fontSize={9}>
						{new Date(d.t).toLocaleTimeString(labels.localeCode, { hour: "2-digit", minute: "2-digit" })}
					</text>
				))}
			</svg>
			<div className="flex items-center gap-4 mt-2 text-[11px]">
				<span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-emerald-400 rounded" /> CPU</span>
				<span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-blue-400 rounded" /> {labels.memory}</span>
				<span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-amber-400 rounded" /> {labels.disk}</span>
			</div>
		</div>
	);
}

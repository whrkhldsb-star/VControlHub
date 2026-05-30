"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getRefreshIntervalFromStorage, getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";

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

type MetricPoint = { cpu: number; mem: number; disk: number; online: boolean; t: string };

type Props = { serverCount: number; systemHealthSummary?: SystemHealthSummary | null };

type RepairSuggestion = {
	id: string;
	label: string;
	description: string;
	action: string;
	status: SystemHealthStatus;
	href?: string;
};

const repairSuggestions = (summary?: SystemHealthSummary | null): RepairSuggestion[] => {
	if (!summary) return [];
	return [
		{
			id: "db",
			label: "检查数据库连接",
			description: summary.critical > 0 ? "优先确认数据库与环境变量是否正常，必要时重载服务并检查日志。" : "数据库状态正常，可继续关注业务层告警。",
			action: "验证 DATABASE_URL、数据库进程和 Prisma 连接",
			status: summary.critical > 0 ? "critical" : "healthy",
		},
		{
			id: "runtime",
			label: "确认运行目录",
			description: summary.warning > 0 ? "部署目录或缓存目录可能缺失，建议补齐并复查权限。" : "运行目录基线已就绪。",
			action: "检查 storage / uploads / downloads / backups / logs / tmp",
			status: summary.warning > 0 ? "warning" : "healthy",
		},
		{
			id: "services",
			label: "核对核心服务",
			description: summary.critical > 0 ? "优先确认 Next.js、SSH WS 与 Caddy 是否都在运行。" : "核心服务在线，可继续检查业务功能。",
			action: "验证 vcontrolhub-next.service / vcontrolhub-ssh-ws.service / caddy.service",
			status: summary.critical > 0 ? "critical" : "healthy",
		},
		{
			id: "git",
			label: "核对 GitHub 同步",
			description: summary.warning > 0 ? "本地与远端可能不同步，建议确认最近推送是否完成。" : "本地提交与 origin/main 保持一致。",
			action: "比对本地 HEAD 与 origin/main",
			status: summary.warning > 0 ? "warning" : "healthy",
		},
		{
			id: "audit",
			label: "复查审计高风险动作",
			description: summary.critical > 0 ? "系统已经出现严重告警，建议结合审计页先锁定最近的高风险操作。" : "可快速查看最近的命令执行、删除、权限和令牌操作。",
			action: "查看 command.execute / storage.file_delete / api_token.create",
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

const statusConfig: Record<string, { bg: string; text: string; dot: string; label: string }> = {
	healthy: { bg: "border-emerald-400/20 bg-emerald-400/10", text: "text-emerald-200", dot: "bg-emerald-400", label: "正常" },
	warning: { bg: "border-amber-400/20 bg-amber-400/10", text: "text-amber-200", dot: "bg-amber-400", label: "警告" },
	critical: { bg: "border-rose-400/20 bg-rose-400/10", text: "text-rose-200", dot: "bg-rose-400", label: "严重" },
	offline: { bg: "border-slate-400/20 bg-slate-400/10", text: "text-slate-200", dot: "bg-slate-500", label: "离线" },
	unknown: { bg: "border-slate-400/20 bg-slate-400/10", text: "text-slate-400", dot: "bg-slate-600", label: "未知" },
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

export function HealthDashboardClient({ serverCount: _serverCount, systemHealthSummary }: Props) {
	void _serverCount;
	const [overview, setOverview] = useState<HealthOverview | null>(null);
	const [loading, setLoading] = useState(true);
	const [history, setHistory] = useState<Record<string, MetricPoint[]>>({});
	const [expandedServer, setExpandedServer] = useState<string | null>(null);
	const [autoRefresh, setAutoRefresh] = useState(true);
	const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(() =>
		typeof window === "undefined" ? 30 : getRefreshIntervalFromStorage(window.localStorage, 30),
	);
	const [lastRefresh, setLastRefresh] = useState<string>("");
	const [loadError, setLoadError] = useState<string | null>(null);
	const [historyErrors, setHistoryErrors] = useState<Record<string, string>>({});
	const [isRefreshing, setIsRefreshing] = useState(false);

	const getErrorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

	const fetchHealth = useCallback(async () => {
		setIsRefreshing(true);
		try {
			const data = await csrfFetch("/api/health") as HealthOverview;
			setOverview(data);
			setLoadError(null);
			setLastRefresh(new Date().toLocaleTimeString("zh-CN"));
		} catch (error) {
			setLoadError(getErrorMessage(error, "加载健康状态失败"));
		} finally {
			setLoading(false);
			setIsRefreshing(false);
		}
	}, []);

	const fetchHistory = useCallback(async (serverId: string) => {
		try {
			const data = await csrfFetch(`/api/health?historyFor=${serverId}&hours=24`);
			setHistory((prev) => ({ ...prev, [serverId]: data.history ?? [] }));
			setHistoryErrors((prev) => {
				const next = { ...prev };
				delete next[serverId];
				return next;
			});
		} catch (error) {
			setHistoryErrors((prev) => ({ ...prev, [serverId]: getErrorMessage(error, "加载历史指标失败") }));
		}
	}, []);

	useEffect(() => {
		const timer = window.setTimeout(() => { void fetchHealth(); }, 0);
		return () => window.clearTimeout(timer);
	}, [fetchHealth]);

	useEffect(() => {
		const readSavedInterval = () => {
			setRefreshIntervalSeconds(getRefreshIntervalFromStorage(window.localStorage, 30));
		};
		readSavedInterval();
		window.addEventListener("storage", readSavedInterval);
		return () => window.removeEventListener("storage", readSavedInterval);
	}, []);

	useEffect(() => {
		if (!autoRefresh || refreshIntervalSeconds <= 0) return;
		const interval = window.setInterval(() => { void fetchHealth(); }, refreshIntervalSeconds * 1000);
		return () => window.clearInterval(interval);
	}, [autoRefresh, fetchHealth, refreshIntervalSeconds]);

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
						<div key={i} className="animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 h-24" />
					))}
				</div>
			</div>
		);
	}

	if (!overview) {
		return (
			<div className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100" role="alert">
				<div>{loadError ?? "健康状态暂不可用"}</div>
				<button
					type="button"
					onClick={fetchHealth}
					disabled={isRefreshing}
					className="mt-3 rounded-lg border border-rose-300/40 px-3 py-1.5 text-xs transition hover:bg-rose-300/10 disabled:cursor-not-allowed disabled:opacity-60"
				>
					{isRefreshing ? "正在重试..." : "重试加载健康状态"}
				</button>
			</div>
		);
	}

	const { total, online, warning, critical, offline } = overview;

	return (
		<div className="space-y-6">
			{loadError && (
				<div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-100">
					{loadError}
				</div>
			)}
			{systemHealthSummary && (
				<>
					<section className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
			<div className="flex items-center justify-between gap-3">
				<div>
					<p className="text-xs uppercase tracking-[0.25em] text-cyan-300/70">系统自检</p>
					<h2 className="mt-1 text-lg font-semibold text-white">修复建议</h2>
				</div>
				<div className="flex flex-wrap gap-2 text-xs text-slate-400">
					<Link href="/audit" className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 transition hover:bg-white/[0.06]">看审计日志</Link>
					<Link href="/" className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 transition hover:bg-white/[0.06]">回到首页</Link>
				</div>
			</div>
						<div className="grid gap-3 lg:grid-cols-3">
							{repairSuggestions(systemHealthSummary).map((item) => {
								const tone = repairToneClasses[item.status];
								return (
									<article key={item.id} className={`rounded-xl border ${tone.border} ${tone.bg} p-4`}>
										<div className="flex items-center justify-between gap-3">
											<h3 className="text-sm font-semibold text-white">{item.label}</h3>
											<span className={`rounded-full border px-2 py-0.5 text-[10px] ${tone.badge}`}>{item.status}</span>
										</div>
										<p className="mt-2 text-sm leading-6 text-slate-300">{item.description}</p>
									<p className="mt-3 text-xs text-slate-400">建议动作：{item.href ? <Link href={item.href} className="text-cyan-200 transition hover:text-cyan-100">{item.action}</Link> : item.action}</p>
								</article>
							);
						})}
						</div>
					</section>
				</>
			)}

			<section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
				<SummaryCard label="节点总数" value={total} color="slate" />
				<SummaryCard label="在线正常" value={online} color="emerald" />
				<SummaryCard label="性能警告" value={warning} color="amber" />
				<SummaryCard label="严重告警" value={critical} color="rose" />
				<SummaryCard label="离线/停用" value={offline} color="slate" />
			</section>
			<div className="flex items-center justify-between">
				<div className="text-xs text-slate-500">
					上次刷新：{lastRefresh || "—"}
					{overview.critical > 0 ? " · 有严重告警" : overview.warning > 0 ? " · 有警告项" : " · 当前整体正常"}
				</div>
				<div className="flex items-center gap-3">
					<button
						type="button"
						onClick={fetchHealth}
						disabled={isRefreshing}
						aria-label="刷新健康状态"
						className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.06] transition disabled:cursor-not-allowed disabled:opacity-60"
					>
						{isRefreshing ? "正在刷新..." : "🔄 刷新"}
					</button>
					<label className="flex items-center gap-2 text-xs text-slate-400">
						<span>自动刷新</span>
						<button
							type="button"
							onClick={() => setAutoRefresh(!autoRefresh)}
							disabled={refreshIntervalSeconds <= 0}
							aria-label="切换健康状态自动刷新"
							className={`relative h-4 w-8 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${autoRefresh ? "bg-cyan-500" : "bg-slate-700"}`}
						>
							<span className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${autoRefresh ? "translate-x-4" : ""}`} />
						</button>
						<span>{refreshIntervalSeconds <= 0 ? "已关闭" : autoRefresh ? `每 ${getRefreshIntervalLabel(refreshIntervalSeconds)}` : `已暂停 · ${getRefreshIntervalLabel(refreshIntervalSeconds)}`}</span>
					</label>
				</div>
			</div>

			{/* Server table */}
			<section className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-white/[0.06] bg-white/[0.02]">
								<th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">节点</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">状态</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">CPU</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">内存</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">磁盘</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">运行时间</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">详情</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-white/[0.04]">
							{overview.servers.map((server) => {
								const sc = statusConfig[server.status] ?? statusConfig.unknown;
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
												{sc.label}
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
												{expandedServer === server.serverId ? "收起 ▲" : "趋势 ▼"}
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
				<section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
					<h3 className="text-sm font-medium text-white/80 mb-4">
						{overview.servers.find((s) => s.serverId === expandedServer)?.serverName} — 过去 24h 趋势
					</h3>
					{historyErrors[expandedServer] ? (
						<div role="alert" className="rounded-lg border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-100">
							{historyErrors[expandedServer]}
						</div>
					) : (
						<SparklineChart data={history[expandedServer] ?? []} />
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
		<article className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
			<div className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</div>
			<div className={`mt-1.5 text-2xl font-semibold ${colorMap[color] ?? "text-white"}`}>{value}</div>
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

function SparklineChart({ data }: { data: MetricPoint[] }) {
	if (data.length === 0) return <div className="text-xs text-slate-500">暂无历史数据</div>;

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
						{new Date(d.t).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
					</text>
				))}
			</svg>
			<div className="flex items-center gap-4 mt-2 text-[11px]">
				<span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-emerald-400 rounded" /> CPU</span>
				<span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-blue-400 rounded" /> 内存</span>
				<span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-amber-400 rounded" /> 磁盘</span>
			</div>
		</div>
	);
}

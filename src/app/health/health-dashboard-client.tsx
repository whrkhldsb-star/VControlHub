"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";

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
	const [lastRefresh, setLastRefresh] = useState<string>("");
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchHealth = useCallback(async () => {
		try {
			const data = await csrfFetch("/api/health") as HealthOverview;
			setOverview(data);
			setLastRefresh(new Date().toLocaleTimeString("zh-CN"));
		} catch { /* ignore */ }
		setLoading(false);
	}, []);

	const fetchHistory = useCallback(async (serverId: string) => {
		try {
			const data = await csrfFetch(`/api/health?historyFor=${serverId}&hours=24`);
			setHistory((prev) => ({ ...prev, [serverId]: data.history ?? [] }));
		} catch { /* ignore */ }
	}, []);

	useEffect(() => {
		const timer = window.setTimeout(() => { void fetchHealth(); }, 0);
		return () => window.clearTimeout(timer);
	}, [fetchHealth]);

	useEffect(() => {
		if (autoRefresh) {
			intervalRef.current = setInterval(fetchHealth, 30_000);
			return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
		}
	}, [autoRefresh, fetchHealth]);

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

	if (!overview) return null;

	const { total, online, warning, critical, offline } = overview;

	return (
		<div className="space-y-6">
			{systemHealthSummary && (
				<section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<SummaryCard label="系统检查" value={systemHealthSummary.total} color="slate" />
					<SummaryCard label="健康" value={systemHealthSummary.healthy} color="emerald" />
					<SummaryCard label="警告" value={systemHealthSummary.warning} color="amber" />
					<SummaryCard label="严重" value={systemHealthSummary.critical} color="rose" />
				</section>
			)}

			{/* Summary cards */}
			<section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
				<SummaryCard label="节点总数" value={total} color="slate" />
				<SummaryCard label="在线正常" value={online} color="emerald" />
				<SummaryCard label="性能警告" value={warning} color="amber" />
				<SummaryCard label="严重告警" value={critical} color="rose" />
				<SummaryCard label="离线/停用" value={offline} color="slate" />
			</section>

			{/* Controls */}
			<div className="flex items-center justify-between">
				<div className="text-xs text-slate-500">
					上次刷新：{lastRefresh || "—"}
				</div>
				<div className="flex items-center gap-3">
					<button
						onClick={fetchHealth}
						className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.06] transition"
					>
						🔄 刷新
					</button>
					<label className="flex items-center gap-2 text-xs text-slate-400">
						<span>自动刷新</span>
						<button
							onClick={() => setAutoRefresh(!autoRefresh)}
							className={`relative w-8 h-4 rounded-full transition-colors ${autoRefresh ? "bg-cyan-500" : "bg-slate-700"}`}
						>
							<span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${autoRefresh ? "translate-x-4" : ""}`} />
						</button>
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
			{expandedServer && history[expandedServer] && (
				<section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
					<h3 className="text-sm font-medium text-white/80 mb-4">
						{overview.servers.find((s) => s.serverId === expandedServer)?.serverName} — 过去 24h 趋势
					</h3>
					<SparklineChart data={history[expandedServer]} />
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

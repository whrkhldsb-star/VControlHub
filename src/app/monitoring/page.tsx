"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";

interface Stats {
	hostname: string; platform: string; arch: string; uptime: string;
	cpu: { model: string; cores: number; usage: string; loadAvg: string[] };
	memory: { total: string; used: string; free: string; usagePercent: string };
	disk: string;
	network: { iface: string; rx: string; tx: string }[];
	topProcesses: { pid: string; cpu: string; mem: string; cmd: string }[];
	tcpConnections: string;
	timestamp: string;
}

/** Card wrapper — extracted to module top to avoid re-creation on every render */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-5">
			<h3 className="text-xs font-medium text-slate-400 mb-3">{title}</h3>
			{children}
		</div>
	);
}

/** Key-value row — extracted to module top to avoid re-creation on every render */
function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between py-1.5">
			<span className="text-xs text-slate-500">{label}</span>
			<span className="text-xs text-white font-mono">{value}</span>
		</div>
	);
}

export default function MonitoringPage() {
	const [stats, setStats] = useState<Stats | null>(null);
	const [loading, setLoading] = useState(true);
	const [autoRefresh, setAutoRefresh] = useState(false);

	const fetchStats = async () => {
		try {
			const data = await csrfFetch("/api/monitoring/stats") as Stats & { error?: string };
			if (!data.error) setStats(data);
		} catch { /* */ }
		finally { setLoading(false); }
	};


	useEffect(() => { fetchStats(); }, []);
	useEffect(() => {
		if (!autoRefresh) return;
		const id = setInterval(fetchStats, 5000);
		return () => clearInterval(id);
	}, [autoRefresh]);

	if (loading) return <PageShell><div className="text-sm text-slate-500">加载中...</div></PageShell>;
	if (!stats) return <PageShell><div className="text-sm text-rose-400">无法获取监控数据</div></PageShell>;

	return (
		<PageShell>
			<h1 className="text-2xl font-bold mb-1">服务器监控</h1>
			<p className="text-slate-400 mb-6">实时系统资源监控</p>

			<div className="flex items-center gap-3 mb-6">
				<button onClick={fetchStats}
					className="px-3 py-1.5 text-xs font-medium bg-cyan-500/10 text-cyan-400 rounded-lg hover:bg-cyan-500/20 transition">刷新</button>
				<button onClick={() => setAutoRefresh(!autoRefresh)}
					className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${autoRefresh ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-700/50 text-slate-400"}`}>
					{autoRefresh ? "● 自动刷新 (5s)" : "自动刷新"}
				</button>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				<Card title="🖥️ 系统信息">
					<Row label="主机名" value={stats.hostname} />
					<Row label="平台" value={`${stats.platform} ${stats.arch}`} />
					<Row label="运行时间" value={stats.uptime} />
				</Card>

				<Card title="⚡ CPU">
					<Row label="型号" value={stats.cpu.model.split(" ").slice(0, 3).join(" ")} />
					<Row label="核心数" value={String(stats.cpu.cores)} />
					<Row label="使用率" value={stats.cpu.usage} />
					<Row label="负载 (1/5/15m)" value={stats.cpu.loadAvg.join(" / ")} />
				</Card>

				<Card title="💾 内存">
					<Row label="总计" value={stats.memory.total} />
					<Row label="已用" value={stats.memory.used} />
					<Row label="可用" value={stats.memory.free} />
					<div className="mt-2">
						<div className="flex justify-between text-[10px] text-slate-500 mb-1">
							<span>使用率</span><span>{stats.memory.usagePercent}%</span>
						</div>
						<div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
							<div className="h-full bg-cyan-500 rounded-full transition-all" style={{ width: `${stats.memory.usagePercent}%` }} />
						</div>
					</div>
				</Card>

				<Card title="💿 磁盘">
					<Row label="使用量" value={stats.disk} />
				</Card>

				<Card title="🌐 网络">
					{stats.network.length > 0 ? stats.network.map((n) => (
						<div key={n.iface} className="py-1.5">
							<div className="text-xs text-white font-mono">{n.iface}</div>
							<div className="text-[10px] text-slate-500">↓ {n.rx} ↑ {n.tx}</div>
						</div>
					)) : <Row label="无数据" value="-" />}
				</Card>

				<Card title="🔗 TCP 连接">
					<Row label="活跃连接" value={stats.tcpConnections} />
				</Card>
			</div>

			{/* Top Processes */}
			<Card title="📊 Top 进程 (按内存)">
				<div className="overflow-x-auto">
					<table className="w-full text-xs">
						<thead>
							<tr className="text-slate-500 border-b border-white/[0.06]">
								<th className="py-2 text-left">PID</th>
								<th className="py-2 text-right">CPU%</th>
								<th className="py-2 text-right">MEM%</th>
								<th className="py-2 text-left pl-4">命令</th>
							</tr>
						</thead>
						<tbody>
							{stats.topProcesses.map((p) => (
								<tr key={p.pid} className="border-b border-white/[0.03]">
									<td className="py-1.5 text-slate-400 font-mono">{p.pid}</td>
									<td className="py-1.5 text-right text-amber-400">{p.cpu}</td>
									<td className="py-1.5 text-right text-cyan-400">{p.mem}</td>
									<td className="py-1.5 pl-4 text-white truncate max-w-[200px]">{p.cmd}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Card>

			<p className="text-[10px] text-slate-600 mt-4">最后更新: {stats.timestamp}</p>
		</PageShell>
	);
}

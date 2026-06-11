"use client";

import { useCallback, useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getRefreshIntervalFromStorage, getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";

type InterfaceTraffic = {
	iface: string;
	rxBytes: number;
	txBytes: number;
	rxLabel: string;
	txLabel: string;
	rxRateBytesPerSecond: number;
	txRateBytesPerSecond: number;
	rxRateLabel: string;
	txRateLabel: string;
	intervalSeconds: number;
};

type TrafficSummary = {
	timestamp: string;
	currentServer: {
		name: string;
		primaryInterface: InterfaceTraffic | null;
		interfaces: InterfaceTraffic[];
	};
	storageNodes: Array<{
		id: string;
		name: string;
		driver: string;
		serverId?: string | null;
		host?: string | null;
		port?: number | null;
		healthStatus: string;
		trafficSource: string;
		trafficSourceLabel: string;
		trafficSourceDetail: string;
		server?: { id: string; name: string; host: string; port: number } | null;
	}>;
	servers: Array<{ id: string; name: string; host: string; port: number }>;
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
	return <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5"> <h2 className="mb-4 text-sm font-medium text-[var(--text-secondary)]">{title}</h2>{children}</section>;
}

function RateBadge({ label, value, color }: { label: string; value: string; color: "cyan" | "emerald" }) {
	const styles = color === "cyan" ? "bg-cyan-500/10 text-cyan-300" : "bg-emerald-500/10 text-emerald-300";
	return <div className={`rounded-xl px-4 py-3 ${styles}`}><div className="text-[11px] opacity-70">{label}</div><div className="mt-1 text-lg font-semibold tabular-nums">{value}</div></div>;
}

function formatStorageHealthStatus(status: string) {
	const normalized = status.trim().toUpperCase();
	if (normalized === "HEALTHY" || normalized === "ONLINE") return "在线";
	if (normalized === "WARNING") return "需关注";
	if (normalized === "CRITICAL" || normalized === "OFFLINE") return "异常";
	if (normalized === "UNKNOWN" || normalized === "") return "未采样";
	return status;
}

export { formatStorageHealthStatus };

export default function TrafficPage({ canManage: _canManage }: { canManage: boolean }) {
	const [summary, setSummary] = useState<TrafficSummary | null>(null);
	const [selectedIface, setSelectedIface] = useState("");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [autoRefresh, setAutoRefresh] = useState(true);
	const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(() =>
		typeof window === "undefined" ? 30 : getRefreshIntervalFromStorage(window.localStorage, 30),
	);

	const fetchSummary = useCallback(async (iface = selectedIface) => {
		try {
			const suffix = iface ? `?iface=${encodeURIComponent(iface)}` : "";
			const data = await csrfFetch(`/api/traffic/summary${suffix}`) as TrafficSummary & { error?: string };
			if (data.error) {
				setError(data.error);
				return;
			}
			setSummary(data);
			setError("");
		} catch {
			setError("无法获取流量数据");
		} finally {
			setLoading(false);
		}
	}, [selectedIface]);

	useEffect(() => {
		const onStorage = () => setRefreshIntervalSeconds(getRefreshIntervalFromStorage(globalThis.localStorage, 30));
		window.addEventListener("storage", onStorage);
		window.addEventListener("vps-preferences-updated", onStorage);
		return () => {
			window.removeEventListener("storage", onStorage);
			window.removeEventListener("vps-preferences-updated", onStorage);
		};
	}, []);

	useEffect(() => {
		const timer = setTimeout(() => { void fetchSummary(); }, 0);
		return () => clearTimeout(timer);
	}, [fetchSummary]);
	useEffect(() => {
		if (!autoRefresh || refreshIntervalSeconds <= 0) return;
		const id = setInterval(() => { void fetchSummary(); }, refreshIntervalSeconds * 1000);
		return () => clearInterval(id);
	}, [autoRefresh, fetchSummary, refreshIntervalSeconds]);

	const primary = summary?.currentServer.primaryInterface ?? null;

	return (
		<PageShell>
			<div className="mb-6 flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold mb-1">流量中心</h1>
					<p className="text-sm text-[var(--text-secondary)]">查看当前服务器网卡流量，并关联存储服务器/远程节点流量来源。</p>
				</div>
				<div className="flex items-center gap-2">
					<button onClick={() => fetchSummary()} className="rounded-lg bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 light:text-cyan-700 hover:bg-cyan-500/20">刷新</button>
					<button onClick={() => setAutoRefresh((v) => !v)} disabled={refreshIntervalSeconds <= 0} className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${autoRefresh ? "bg-emerald-500/10 text-emerald-300" : "bg-slate-700/60 text-slate-300"}`}>{autoRefresh ? `● ${getRefreshIntervalLabel(refreshIntervalSeconds)} 自动刷新` : refreshIntervalSeconds <= 0 ? "自动刷新已关闭" : `自动刷新 (${getRefreshIntervalLabel(refreshIntervalSeconds)})`}</button>
				</div>
			</div>

			{error && <div className="mb-4 rounded-lg bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>}
			{loading && <div className="text-sm text-slate-500">加载中...</div>}

			{summary && (
				<div className="space-y-5">
					<Card title="当前服务器实时流量">
						<div className="mb-4 flex flex-wrap items-center gap-3">
							<label className="text-xs text-slate-500">网卡</label>
							<select value={selectedIface} onChange={(e) => setSelectedIface(e.target.value)} className="rounded-lg border border-white/[0.08] bg-slate-950 light:bg-white px-3 py-1.5 text-xs text-slate-200">
								<option value="">自动选择主网卡</option>
								{summary.currentServer.interfaces.map((item) => <option key={item.iface} value={item.iface}>{item.iface}</option>)}
							</select>
							<span className="text-[11px] text-slate-600">最后更新：{new Date(summary.timestamp).toLocaleString("zh-CN")}</span>
						</div>
						{primary ? (
							<>
								<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
									<RateBadge label={`↓ 下载速度 · ${primary.iface}`} value={primary.rxRateLabel} color="cyan" />
									<RateBadge label={`↑ 上传速度 · ${primary.iface}`} value={primary.txRateLabel} color="emerald" />
								</div>
								<div className="mt-4 grid grid-cols-1 gap-3 text-xs text-[var(--text-secondary)] md:grid-cols-2">
									<div className="rounded-xl bg-black/20 p-3 light:bg-slate-50 light:ring-1 light:ring-slate-200">累计下载：<span className="font-mono text-slate-100">{primary.rxLabel}</span></div>
									<div className="rounded-xl bg-black/20 p-3 light:bg-slate-50 light:ring-1 light:ring-slate-200">累计上传：<span className="font-mono text-slate-100">{primary.txLabel}</span></div>
								</div>
							</>
						) : <div className="text-sm text-slate-500">暂无网卡数据</div>}
					</Card>

					<Card title="网卡明细">
						<div className="overflow-x-auto">
							<table className="w-full text-xs">
								<thead className="text-slate-500"><tr><th className="py-2 text-left">网卡</th><th className="text-right">下载速度</th><th className="text-right">上传速度</th><th className="text-right">累计下载</th><th className="text-right">累计上传</th></tr></thead>
								<tbody>
									{summary.currentServer.interfaces.map((item) => <tr key={item.iface} className="border-t border-white/[0.04]"><td className="py-2 font-mono text-white">{item.iface}</td><td className="text-right text-cyan-300 light:text-cyan-700">{item.rxRateLabel}</td><td className="text-right text-emerald-300 light:text-emerald-700">{item.txRateLabel}</td><td className="text-right text-[var(--text-secondary)]">{item.rxLabel}</td><td className="text-right text-[var(--text-secondary)]">{item.txLabel}</td></tr>)}
								</tbody>
							</table>
						</div>
					</Card>

					<Card title="存储节点流量来源">
						<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
							{summary.storageNodes.map((node) => <div key={node.id} className="rounded-xl border border-white/[0.05] bg-black/20 p-4"><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium text-white">{node.name}</div><div className="mt-1 text-[11px] text-slate-500">{node.driver} · {node.trafficSourceLabel}</div></div><span className="rounded-full bg-slate-800 light:bg-slate-100 px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">{formatStorageHealthStatus(node.healthStatus)}</span></div><div className="mt-3 text-xs text-[var(--text-secondary)]">{node.trafficSourceDetail}</div></div>)}
							{summary.storageNodes.length === 0 && <div className="text-sm text-slate-500">暂无存储节点</div>}
						</div>
					</Card>
				</div>
			)}
		</PageShell>
	);
}

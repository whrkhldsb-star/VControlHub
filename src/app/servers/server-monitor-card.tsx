"use client";

import { useEffect, useState, useCallback } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";
import { useRefreshInterval } from "@/lib/preferences/use-refresh-interval";

/* ── Types ────────────────────────────────────────────────── */

type CpuInfo = { usagePercent: number; cores: number; loadAvg: [number, number, number] };
type MemInfo = { totalMb: number; usedMb: number; availableMb: number; usagePercent: number };
type DiskInfo = { mount: string; totalGb: string; usedGb: string; usagePercent: number };
type NetInfo = { iface: string; rxBytes: number; txBytes: number };

type Metrics = {
	cpu: CpuInfo;
	memory: MemInfo;
	disk: DiskInfo[];
	network: NetInfo[];
	uptime: string;
	timestamp: string;
};

type Props = {
	serverId: string;
	serverName: string;
};

/* ── Utility ──────────────────────────────────────────────── */

function formatBytes(bytes: number): string {
	if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
	if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
	if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${bytes} B`;
}

function usageColor(pct: number): string {
	if (pct >= 90) return "bg-rose-400";
	if (pct >= 70) return "bg-amber-400";
	return "bg-cyan-400";
}

function usageTextColor(pct: number): string {
	if (pct >= 90) return "text-rose-300";
	if (pct >= 70) return "text-amber-300";
	return "text-cyan-300";
}

/* ── Sub-components ───────────────────────────────────────── */

function ProgressBar({ value, max = 100, className = "" }: { value: number; max?: number; className?: string }) {
	const pct = Math.min(100, Math.max(0, (value / max) * 100));
	return (
		<div className={`h-1.5 rounded-full bg-white/[0.06] overflow-hidden ${className}`}>
			<div
				className={`h-full rounded-full transition-[width] duration-700 ${usageColor(pct)}`}
				style={{ width: `${pct}%` }}
			/>
		</div>
	);
}

function MetricRow({ label, value, unit, pct }: { label: string; value: string; unit?: string; pct?: number }) {
	return (
		<div className="flex items-center justify-between gap-2 text-xs">
			<span className="text-slate-500 shrink-0">{label}</span>
			{pct !== undefined && <ProgressBar value={pct} className="flex-1 min-w-[40px]" />}
			<span className={`font-mono tabular-nums ${pct !== undefined ? usageTextColor(pct) : "text-white/80"}`}>
				{value}{unit && <span className="text-slate-600 ml-0.5">{unit}</span>}
			</span>
		</div>
	);
}

/* ── Main component ───────────────────────────────────────── */

export function ServerMonitorCard({ serverId }: Props) {
	const [metrics, setMetrics] = useState<Metrics | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const refreshIntervalSeconds = useRefreshInterval(30);

	const fetchMetrics = useCallback(async () => {
	try {
			const data = await csrfFetch(`/api/servers/monitor?serverId=${encodeURIComponent(serverId)}`) as Metrics & { error?: string };
			if (data.error) {
				setError(data.error);
				setMetrics(null);
			} else {
				setMetrics(data);
				setError(null);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "获取监控数据失败");
			setMetrics(null);
		} finally {
			setLoading(false);
		}
	}, [serverId]);

	useEffect(() => {
		const timer = window.setTimeout(() => { void fetchMetrics(); }, 0);
		if (refreshIntervalSeconds <= 0) return () => window.clearTimeout(timer);
		const interval = setInterval(() => { void fetchMetrics(); }, refreshIntervalSeconds * 1000);
		return () => {
			window.clearTimeout(timer);
			clearInterval(interval);
		};
	}, [fetchMetrics, refreshIntervalSeconds]);

	if (loading) {
		return (
			<div data-card className=" p-4 space-y-2 animate-pulse">
				<div className="h-3 w-24 bg-white/[0.06] rounded-lg" />
				<div className="h-3 w-full bg-white/[0.06] rounded-lg" />
				<div className="h-3 w-full bg-white/[0.06] rounded-lg" />
				<div className="h-3 w-3/4 bg-white/[0.06] rounded-lg" />
			</div>
		);
	}

	if (error) {
		return (
			<div data-tone="rose" className="rounded-xl border border-rose-400/20 p-4">
				<div className="flex items-center gap-2 text-xs text-rose-300">
					<span>⚠</span>
					<span>监控连接失败：{error}</span>
				</div>
				<button
					onClick={fetchMetrics}
					className="mt-2 text-xs text-rose-400/70 hover:text-rose-300 transition"
				>
					重试
				</button>
			</div>
		);
	}

	if (!metrics) return null;

	const { cpu, memory, disk, network, uptime } = metrics;

	return (
		<div data-card className=" p-4 space-y-3">
			{/* Header */}
			<div className="flex items-center justify-between">
				<h4 className="text-xs font-medium text-white/60 uppercase tracking-wider">实时监控</h4>
				<div className="flex items-center gap-1.5">
					<div className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.5)] animate-pulse" />
					<span className="text-[10px] text-slate-600">{new Date(metrics.timestamp).toLocaleTimeString("zh-CN")}</span>
					<span className="text-[10px] text-slate-700">· {getRefreshIntervalLabel(refreshIntervalSeconds)}</span>
				</div>
			</div>

			{/* CPU */}
			<div className="space-y-1.5">
				<div className="flex items-center justify-between text-[11px] text-slate-500">
					<span>CPU</span>
					<span className="text-slate-600">{cpu.cores} 核</span>
				</div>
				<ProgressBar value={cpu.usagePercent} />
				<div className="flex items-center justify-between">
					<span className={`text-sm font-semibold tabular-nums ${usageTextColor(cpu.usagePercent)}`}>
						{cpu.usagePercent.toFixed(1)}%
					</span>
					<span className="text-[10px] text-slate-600 font-mono">
						负载 {cpu.loadAvg[0].toFixed(2)} / {cpu.loadAvg[1].toFixed(2)} / {cpu.loadAvg[2].toFixed(2)}
					</span>
				</div>
			</div>

			{/* Memory */}
			<div className="space-y-1.5">
				<div className="flex items-center justify-between text-[11px] text-slate-500">
					<span>内存</span>
					<span className="text-slate-600">{memory.usedMb} / {memory.totalMb} MB</span>
				</div>
				<ProgressBar value={memory.usagePercent} />
				<span className={`text-sm font-semibold tabular-nums ${usageTextColor(memory.usagePercent)}`}>
					{memory.usagePercent.toFixed(1)}%
				</span>
			</div>

			{/* Disk */}
			{disk.length > 0 && (
				<div className="space-y-1.5">
					<span className="text-[11px] text-slate-500">磁盘</span>
					{disk.map((d) => (
						<MetricRow
							key={d.mount}
							label={d.mount}
							value={`${d.usedGb} / ${d.totalGb}`}
							pct={d.usagePercent}
						/>
					))}
			</div>
			)}

			{/* Network */}
			{network.length > 0 && (
				<div className="space-y-1.5">
					<span className="text-[11px] text-slate-500">网络流量</span>
					{network.map((n) => (
						<div key={n.iface} className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
							<span className="text-slate-500">{n.iface}</span>
							<span className="font-mono text-[11px]">
								↓{formatBytes(n.rxBytes)} ↑{formatBytes(n.txBytes)}
							</span>
						</div>
					))}
			</div>
			)}

			{/* Uptime */}
			{uptime && (
				<div className="pt-1 border-t border-white/[0.04] text-[11px] text-slate-600">
					运行 {uptime}
				</div>
			)}
		</div>
	);
}

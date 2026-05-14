"use client";

import { useEffect, useState } from "react";
import {
	AreaChart, Area, BarChart, Bar, LineChart, Line,
	XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { csrfFetch } from "@/lib/auth/csrf-client";

type AnalyticsData = {
	servers?: Array<{ time: string; cpu: number; memory: number; disk: number }>;
	downloads?: Array<{ date: string; completed: number; failed: number; running: number; pending: number }>;
	audit?: Array<{ date: string; total: number }>;
	imageBed?: Array<{ date: string; count: number; size: number }>;
};

export function DashboardCharts() {
	const [data, setData] = useState<AnalyticsData | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		(async () => {
			try {
const json = await csrfFetch("/api/dashboard/analytics?type=all");
setData(json);
			} catch { /* ignore */ }
			setLoading(false);
		})();
	}, []);

	if (loading) {
		return (
			<div className="grid gap-4 lg:grid-cols-2">
				{[1, 2, 3, 4].map((i) => (
					<div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 animate-pulse">
						<div className="h-4 w-32 bg-slate-800 rounded mb-4" />
						<div className="h-48 bg-slate-800/50 rounded" />
					</div>
				))}
			</div>
		);
	}

	if (!data) return null;

	const hasData = (arr?: unknown[]) => arr && arr.length > 0;

	return (
		<div className="grid gap-4 lg:grid-cols-2">
			{/* Server Metrics Trend */}
			{hasData(data.servers) && (
				<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
					<h3 className="text-sm font-medium text-slate-300 mb-4">📈 服务器资源趋势（24h）</h3>
					<ResponsiveContainer width="100%" height={200}>
						<AreaChart data={data.servers}>
							<CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
							<XAxis dataKey="time" tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(v: string) => new Date(v).getHours() + ":00"} />
							<YAxis tick={{ fontSize: 10, fill: "#64748b" }} unit="%" />
							<Tooltip contentStyle={{ backgroundColor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
							<Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
							<Area type="monotone" dataKey="cpu" stroke="#22d3ee" fill="rgba(34,211,238,0.1)" name="CPU" />
							<Area type="monotone" dataKey="memory" stroke="#a78bfa" fill="rgba(167,139,250,0.1)" name="内存" />
							<Area type="monotone" dataKey="disk" stroke="#fbbf24" fill="rgba(251,191,36,0.1)" name="磁盘" />
						</AreaChart>
					</ResponsiveContainer>
				</div>
			)}

			{/* Download Task Trend */}
			{hasData(data.downloads) && (
				<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
					<h3 className="text-sm font-medium text-slate-300 mb-4">⬇️ 下载任务趋势（7天）</h3>
					<ResponsiveContainer width="100%" height={200}>
						<BarChart data={data.downloads}>
							<CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
							<XAxis dataKey="date" tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(v: string) => v.slice(5)} />
							<YAxis tick={{ fontSize: 10, fill: "#64748b" }} />
							<Tooltip contentStyle={{ backgroundColor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
							<Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
							<Bar dataKey="completed" stackId="a" fill="#34d399" name="完成" />
							<Bar dataKey="failed" stackId="a" fill="#f87171" name="失败" />
							<Bar dataKey="running" stackId="a" fill="#22d3ee" name="运行中" />
							<Bar dataKey="pending" stackId="a" fill="#94a3b8" name="等待中" />
						</BarChart>
					</ResponsiveContainer>
				</div>
			)}

			{/* Audit Activity */}
			{hasData(data.audit) && (
				<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
					<h3 className="text-sm font-medium text-slate-300 mb-4">📋 操作活动趋势（30天）</h3>
					<ResponsiveContainer width="100%" height={200}>
						<BarChart data={data.audit}>
							<CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
							<XAxis dataKey="date" tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(v: string) => v.slice(5)} />
							<YAxis tick={{ fontSize: 10, fill: "#64748b" }} />
							<Tooltip contentStyle={{ backgroundColor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
							<Bar dataKey="total" fill="#818cf8" radius={[3, 3, 0, 0]} name="操作次数" />
						</BarChart>
					</ResponsiveContainer>
				</div>
			)}

			{/* Image Bed Upload Trend */}
			{hasData(data.imageBed) && (
				<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
					<h3 className="text-sm font-medium text-slate-300 mb-4">🖼️ 图床上传趋势（7天）</h3>
					<ResponsiveContainer width="100%" height={200}>
						<LineChart data={data.imageBed}>
							<CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
							<XAxis dataKey="date" tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(v: string) => v.slice(5)} />
							<YAxis yAxisId="left" tick={{ fontSize: 10, fill: "#64748b" }} />
							<YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(v: number) => v > 1024 * 1024 ? `${(v / 1024 / 1024).toFixed(1)}M` : v > 1024 ? `${(v / 1024).toFixed(0)}K` : `${v}B`} />
							<Tooltip contentStyle={{ backgroundColor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
							<Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
							<Line yAxisId="left" type="monotone" dataKey="count" stroke="#f472b6" name="上传数" dot={false} />
							<Line yAxisId="right" type="monotone" dataKey="size" stroke="#34d399" name="数据量" dot={false} />
						</LineChart>
					</ResponsiveContainer>
				</div>
			)}

			{/* Empty state */}
			{!hasData(data.servers) && !hasData(data.downloads) && !hasData(data.audit) && !hasData(data.imageBed) && (
				<div className="lg:col-span-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-10 text-center text-sm text-slate-500">
					暂无足够数据生成图表，使用一段时间后会自动展示趋势分析
				</div>
			)}
		</div>
	);
}

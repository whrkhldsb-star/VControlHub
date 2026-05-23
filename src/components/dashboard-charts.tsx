"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";

type ServerMetric = { time: string; cpu: number; memory: number; disk: number };
type CountSeries = { date: string; total: number };
type DownloadSeries = { date: string; completed: number; failed: number; running: number; pending: number };
type ImageBedSeries = { date: string; count: number; size: number };

type AnalyticsData = {
	servers?: ServerMetric[];
	downloads?: DownloadSeries[];
	audit?: CountSeries[];
	imageBed?: ImageBedSeries[];
};

type LinePoint = { x: number; y: number };

type Series = {
	key: string;
	label: string;
	color: string;
	points: number[];
	fill?: boolean;
};

const CHART_HEIGHT = 200;
const PAD_X = 34;
const PAD_Y = 18;

function hasData(arr?: unknown[]) {
	return Array.isArray(arr) && arr.length > 0;
}

function formatBytes(value: number) {
	if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}M`;
	if (value >= 1024) return `${Math.round(value / 1024)}K`;
	return `${value}B`;
}

function formatHour(value: string) {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : `${date.getHours()}:00`;
}

function formatDay(value: string) {
	return value.length > 5 ? value.slice(5) : value;
}

function linePath(points: LinePoint[]) {
	return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}

function areaPath(points: LinePoint[], baseline: number) {
	if (points.length === 0) return "";
	return `${linePath(points)} L${points.at(-1)?.x.toFixed(1)},${baseline.toFixed(1)} L${points[0].x.toFixed(1)},${baseline.toFixed(1)} Z`;
}

function MiniLineChart({
	title,
	labels,
	series,
	max = 100,
	valueFormatter = (value) => String(Math.round(value)),
}: {
	title: string;
	labels: string[];
	series: Series[];
	max?: number;
	valueFormatter?: (value: number) => string;
}) {
	const width = 640;
	const plotWidth = width - PAD_X * 2;
	const plotHeight = CHART_HEIGHT - PAD_Y * 2;
	const safeMax = Math.max(max, ...series.flatMap((item) => item.points), 1);
	const divisor = Math.max(labels.length - 1, 1);
	const chartSeries = series.map((item) => ({
		...item,
		pathPoints: item.points.map((value, index) => ({
			x: PAD_X + (index / divisor) * plotWidth,
			y: PAD_Y + (1 - value / safeMax) * plotHeight,
		})),
	}));

	return (
		<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
			<div className="mb-4 flex items-center justify-between gap-3">
				<h3 className="text-sm font-medium text-slate-300">{title}</h3>
				<div className="flex flex-wrap justify-end gap-2 text-[11px] text-slate-400">
					{series.map((item) => (
						<span key={item.key} className="inline-flex items-center gap-1">
							<span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
							{item.label}
						</span>
					))}
				</div>
			</div>
			<svg role="img" aria-label={title} viewBox={`0 0 ${width} ${CHART_HEIGHT}`} className="h-52 w-full overflow-visible">
				<line x1={PAD_X} x2={width - PAD_X} y1={CHART_HEIGHT - PAD_Y} y2={CHART_HEIGHT - PAD_Y} stroke="rgba(148,163,184,0.18)" />
				<line x1={PAD_X} x2={PAD_X} y1={PAD_Y} y2={CHART_HEIGHT - PAD_Y} stroke="rgba(148,163,184,0.18)" />
				{[0.25, 0.5, 0.75].map((ratio) => (
					<line key={ratio} x1={PAD_X} x2={width - PAD_X} y1={PAD_Y + plotHeight * ratio} y2={PAD_Y + plotHeight * ratio} stroke="rgba(148,163,184,0.08)" strokeDasharray="3 5" />
				))}
				{chartSeries.map((item) => (
					<g key={item.key}>
						{item.fill && <path d={areaPath(item.pathPoints, CHART_HEIGHT - PAD_Y)} fill={item.color} opacity="0.13" />}
						<path d={linePath(item.pathPoints)} fill="none" stroke={item.color} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
					</g>
				))}
				<text x={PAD_X} y={13} fill="#64748b" fontSize="11">{valueFormatter(safeMax)}</text>
				<text x={PAD_X} y={CHART_HEIGHT - 2} fill="#64748b" fontSize="11">0</text>
				{labels.length > 0 && (
					<>
						<text x={PAD_X} y={CHART_HEIGHT - 2} fill="#64748b" fontSize="11" textAnchor="start">{labels[0]}</text>
						<text x={width - PAD_X} y={CHART_HEIGHT - 2} fill="#64748b" fontSize="11" textAnchor="end">{labels.at(-1)}</text>
					</>
				)}
			</svg>
		</div>
	);
}

function MiniStackedBarChart({ title, labels, series }: { title: string; labels: string[]; series: Series[] }) {
	const width = 640;
	const plotWidth = width - PAD_X * 2;
	const plotHeight = CHART_HEIGHT - PAD_Y * 2;
	const totals = labels.map((_, index) => series.reduce((sum, item) => sum + (item.points[index] ?? 0), 0));
	const max = Math.max(...totals, 1);
	const gap = 8;
	const barWidth = Math.max(8, (plotWidth - gap * Math.max(labels.length - 1, 0)) / Math.max(labels.length, 1));

	return (
		<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
			<div className="mb-4 flex items-center justify-between gap-3">
				<h3 className="text-sm font-medium text-slate-300">{title}</h3>
				<div className="flex flex-wrap justify-end gap-2 text-[11px] text-slate-400">
					{series.map((item) => (
						<span key={item.key} className="inline-flex items-center gap-1">
							<span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
							{item.label}
						</span>
					))}
				</div>
			</div>
			<svg role="img" aria-label={title} viewBox={`0 0 ${width} ${CHART_HEIGHT}`} className="h-52 w-full overflow-visible">
				{[0.25, 0.5, 0.75, 1].map((ratio) => (
					<line key={ratio} x1={PAD_X} x2={width - PAD_X} y1={PAD_Y + plotHeight * ratio} y2={PAD_Y + plotHeight * ratio} stroke="rgba(148,163,184,0.08)" strokeDasharray="3 5" />
				))}
				{labels.map((label, index) => {
					let stackedHeight = 0;
					const x = PAD_X + index * (barWidth + gap);
					return (
						<g key={`${label}-${index}`}>
							{series.map((item) => {
								const height = ((item.points[index] ?? 0) / max) * plotHeight;
								stackedHeight += height;
								return <rect key={item.key} x={x} y={CHART_HEIGHT - PAD_Y - stackedHeight} width={barWidth} height={Math.max(height, 0)} fill={item.color} rx="2" />;
							})}
							<text x={x + barWidth / 2} y={CHART_HEIGHT - 2} fill="#64748b" fontSize="10" textAnchor="middle">{label}</text>
						</g>
					);
				})}
				<text x={PAD_X} y={13} fill="#64748b" fontSize="11">{max}</text>
			</svg>
		</div>
	);
}

export function DashboardCharts() {
	const [data, setData] = useState<AnalyticsData | null>(null);
	const [loading, setLoading] = useState(true);
	const cancelledRef = useRef(false);

	useEffect(() => {
		cancelledRef.current = false;
		(async () => {
			try {
				const json = await csrfFetch("/api/dashboard/analytics?type=all");
				if (!cancelledRef.current) setData(json);
			} catch {
				// Dashboard charts are non-critical; keep the rest of the dashboard usable.
			} finally {
				if (!cancelledRef.current) setLoading(false);
			}
		})();
		return () => {
			cancelledRef.current = true;
		};
	}, []);

	const charts = useMemo(() => {
		if (!data) return null;
		return {
			serverLabels: data.servers?.map((item) => formatHour(item.time)) ?? [],
			downloadLabels: data.downloads?.map((item) => formatDay(item.date)) ?? [],
			auditLabels: data.audit?.map((item) => formatDay(item.date)) ?? [],
			imageLabels: data.imageBed?.map((item) => formatDay(item.date)) ?? [],
		};
	}, [data]);

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

	if (!data || !charts) return null;

	return (
		<div className="grid gap-4 lg:grid-cols-2">
			{hasData(data.servers) && (
				<MiniLineChart
					title="📈 服务器资源趋势（24h）"
					labels={charts.serverLabels}
					max={100}
					valueFormatter={(value) => `${Math.round(value)}%`}
					series={[
						{ key: "cpu", label: "CPU", color: "#22d3ee", points: data.servers!.map((item) => item.cpu), fill: true },
						{ key: "memory", label: "内存", color: "#a78bfa", points: data.servers!.map((item) => item.memory), fill: true },
						{ key: "disk", label: "磁盘", color: "#fbbf24", points: data.servers!.map((item) => item.disk), fill: true },
					]}
				/>
			)}

			{hasData(data.downloads) && (
				<MiniStackedBarChart
					title="⬇️ 下载任务趋势（7天）"
					labels={charts.downloadLabels}
					series={[
						{ key: "completed", label: "完成", color: "#34d399", points: data.downloads!.map((item) => item.completed) },
						{ key: "failed", label: "失败", color: "#f87171", points: data.downloads!.map((item) => item.failed) },
						{ key: "running", label: "运行中", color: "#22d3ee", points: data.downloads!.map((item) => item.running) },
						{ key: "pending", label: "等待中", color: "#94a3b8", points: data.downloads!.map((item) => item.pending) },
					]}
				/>
			)}

			{hasData(data.audit) && (
				<MiniStackedBarChart
					title="📋 操作活动趋势（30天）"
					labels={charts.auditLabels}
					series={[{ key: "total", label: "操作次数", color: "#818cf8", points: data.audit!.map((item) => item.total) }]}
				/>
			)}

			{hasData(data.imageBed) && (
				<MiniLineChart
					title="🖼️ 图床上传趋势（7天）"
					labels={charts.imageLabels}
					max={Math.max(...data.imageBed!.map((item) => Math.max(item.count, item.size)), 1)}
					valueFormatter={formatBytes}
					series={[
						{ key: "count", label: "上传数", color: "#f472b6", points: data.imageBed!.map((item) => item.count) },
						{ key: "size", label: "数据量", color: "#34d399", points: data.imageBed!.map((item) => item.size) },
					]}
				/>
			)}

			{!hasData(data.servers) && !hasData(data.downloads) && !hasData(data.audit) && !hasData(data.imageBed) && (
				<div className="lg:col-span-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-10 text-center text-sm text-slate-500">
					暂无足够数据生成图表，使用一段时间后会自动展示趋势分析
				</div>
			)}
		</div>
	);
}

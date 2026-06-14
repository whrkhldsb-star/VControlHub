/**
 * SparklineChart — small inline SVG trend chart used by the health
 * dashboard's per-server "trend" expansion panel.
 *
 * Extracted from `health-dashboard-client.tsx` (TR-036) so it can ship
 * inside its own lazy chunk: the chart is only rendered when the user
 * clicks "趋势" on a server row, so the initial /health page bundle
 * shouldn't carry the SVG path / viewBox math either.
 *
 * The component is pure (no hooks, no state, no context) — it just
 * transforms `MetricPoint[]` into SVG paths. That makes it a clean
 * candidate for a code-split boundary: there are no cross-file
 * dependencies beyond the shared `MetricPoint` type.
 */
import type { MetricPoint } from "./health-types";

export type SparklineChartProps = {
	data: MetricPoint[];
	locale: "zh" | "en";
};

export function SparklineChart({ data, locale }: SparklineChartProps) {
	const labels = locale === "zh" ? { memory: "内存", disk: "磁盘", localeCode: "zh-CN" } : { memory: "Memory", disk: "Disk", localeCode: "en-US" };
	if (data.length === 0) return <div className="text-xs text-slate-500">{locale === "zh" ? "暂无历史数据" : "No history data yet"}</div>;

	const W = 700;
	const H = 200;
	const padX = 40;
	const padY = 20;
	const plotW = W - padX * 2;
	const plotH = H - padY * 2;

	const maxVal = 100;
	const minTime = new Date(data[0]!.t).getTime();
	const maxTime = new Date(data[data.length - 1]!.t).getTime();
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

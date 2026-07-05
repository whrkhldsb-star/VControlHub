/**
 * SparklineChart — small inline SVG trend chart used by the health dashboard's
 * per-server trend expansion panel.
 *
 * The component is pure (no hooks/state/context): it only transforms
 * `MetricPoint[]` into SVG paths, so it remains safe to lazy-load.
 */
import { toDateLocale } from "@/lib/i18n/locale-format";
import { t } from "@/lib/i18n/translations";
import type { MetricPoint } from "./health-types";

export type SparklineChartProps = {
	data: MetricPoint[];
	locale: "zh" | "en";
};

function buildPath(
	data: MetricPoint[],
	select: (point: MetricPoint) => number,
	toX: (timestamp: number) => number,
	toY: (value: number) => number,
) {
	return data
		.map((point, index) => {
			const command = index === 0 ? "M" : "L";
			return `${command} ${toX(new Date(point.t).getTime())} ${toY(select(point))}`;
		})
		.join(" ");
}

export function SparklineChart({ data, locale }: SparklineChartProps) {
	if (data.length === 0) {
		return <div className="text-xs text-[var(--text-muted)]">{t("healthPage.sparkline.noHistoryData", locale)}</div>;
	}

	const labels = {
		memory: t("healthPage.ui.memory", locale),
		disk: t("healthPage.ui.disk", locale),
		localeCode: toDateLocale(locale),
	};
	const width = 700;
	const height = 200;
	const padX = 40;
	const padY = 20;
	const plotWidth = width - padX * 2;
	const plotHeight = height - padY * 2;
	const maxValue = 100;
	const minTime = new Date(data[0]!.t).getTime();
	const maxTime = new Date(data[data.length - 1]!.t).getTime();
	const timeRange = maxTime - minTime || 1;
	const toX = (timestamp: number) => padX + ((timestamp - minTime) / timeRange) * plotWidth;
	const toY = (value: number) => padY + plotHeight - (value / maxValue) * plotHeight;

	const cpuPath = buildPath(data, (point) => point.cpu, toX, toY);
	const memPath = buildPath(data, (point) => point.mem, toX, toY);
	const diskPath = buildPath(data, (point) => point.disk, toX, toY);
	const warnY = toY(80);
	const critY = toY(95);

	return (
		<div className="overflow-x-auto">
			<svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[500px]" style={{ height: "auto" }}>
				<line x1={padX} y1={warnY} x2={width - padX} y2={warnY} stroke="rgba(251,191,36,0.2)" strokeWidth={1} strokeDasharray="4,4" />
				<line x1={padX} y1={critY} x2={width - padX} y2={critY} stroke="rgba(244,63,94,0.2)" strokeWidth={1} strokeDasharray="4,4" />
				<text x={padX - 4} y={warnY + 4} textAnchor="end" fill="rgba(251,191,36,0.5)" fontSize={9}>80%</text>
				<text x={padX - 4} y={critY + 4} textAnchor="end" fill="rgba(244,63,94,0.5)" fontSize={9}>95%</text>

				<path d={cpuPath} fill="none" stroke="#4ade80" strokeWidth={1.5} />
				<path d={memPath} fill="none" stroke="#60a5fa" strokeWidth={1.5} />
				<path d={diskPath} fill="none" stroke="#a78bfa" strokeWidth={1.5} />

				{data.filter((_, index) => index % Math.ceil(data.length / 6) === 0).map((point) => {
					const x = toX(new Date(point.t).getTime());
					return (
						<text key={point.t} x={x} y={height - 4} textAnchor="middle" fill="rgba(148,163,184,0.6)" fontSize={9}>
							{new Date(point.t).toLocaleTimeString(labels.localeCode, { hour: "2-digit", minute: "2-digit" })}
						</text>
					);
				})}
			</svg>
			<div className="mt-2 flex gap-4 text-xs text-[var(--text-muted)]">
				<span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#4ade80]" />CPU</span>
				<span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#60a5fa]" />{labels.memory}</span>
				<span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#a78bfa]" />{labels.disk}</span>
			</div>
		</div>
	);
}

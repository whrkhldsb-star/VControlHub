"use client";

/**
 * Download / upload rate over time for /traffic, drawn with the shared
 * time-series chart (rate axis, cursor readout, data table) in the colours of
 * the rate badges above it. The chart is drawn at its on-screen width, so it
 * never stretches the way the old fixed 560×140 sparkline did.
 */
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { formatShortTime, formatTime } from "@/lib/datetime/format";
import { useI18n } from "@/lib/i18n/use-locale";

export type TrafficSample = {
	/** Sample timestamp (ms since epoch). */
	t: number;
	/** RX rate in bytes/second. */
	rx: number;
	/** TX rate in bytes/second. */
	tx: number;
};

export function formatTrafficRate(bytesPerSecond: number): string {
	if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return "—";
	const units = ["B/s", "KB/s", "MB/s", "GB/s"];
	let value = bytesPerSecond;
	let index = 0;
	while (value >= 1024 && index < units.length - 1) {
		value /= 1024;
		index++;
	}
	return `${value.toFixed(value >= 100 || index === 0 ? 0 : value >= 10 ? 1 : 2)} ${units[index]}`;
}

/**
 * Axis top in round numbers of the unit the labels use (20 KB/s, not the
 * 19.5 KB/s that rounding 20,000 bytes gives).
 */
export function trafficAxisMax(maxRate: number): number {
	const target = Math.max(maxRate * 1.1, 1);
	let unit = 1;
	while (target / unit >= 1024 && unit < 1024 ** 3) unit *= 1024;
	const value = target / unit;
	const base = 10 ** Math.floor(Math.log10(value));
	const step = [1, 2, 2.5, 5, 10].find((candidate) => value <= candidate * base) ?? 10;
	return step * base * unit;
}

export function TrafficChart({ samples, live = false, height = 200 }: {
	samples: TrafficSample[];
	/** Live samples are seconds apart, so their times carry seconds. */
	live?: boolean;
	height?: number;
}) {
	const { t, locale } = useI18n();
	if (samples.length < 2) {
		return (
			<div data-inset="" data-traffic-chart-empty className="flex items-center justify-center border-dashed text-xs text-[var(--text-muted)]" style={{ height }}>
				{t("trafficPage.chart.empty")}
			</div>
		);
	}
	const last = samples[samples.length - 1]!;
	return (
		<div data-traffic-chart className="min-w-0">
			<TimeSeriesChart
				ariaLabel={t("trafficPage.chart.aria", { rx: formatTrafficRate(last.rx), tx: formatTrafficRate(last.tx), count: samples.length })}
				from={samples[0]!.t}
				to={last.t}
				series={[
					{ key: "rx", label: t("trafficPage.rxShort"), color: "var(--accent)", points: samples.map((sample) => ({ t: sample.t, v: sample.rx })) },
					{ key: "tx", label: t("trafficPage.txShort"), color: "var(--success)", points: samples.map((sample) => ({ t: sample.t, v: sample.tx })) },
				]}
				yMax={trafficAxisMax(Math.max(...samples.map((sample) => Math.max(sample.rx, sample.tx))))}
				formatY={formatTrafficRate}
				formatX={(time) => (live ? formatTime(time, locale) : formatShortTime(time, locale))}
				emptyLabel={t("trafficPage.chart.empty")}
				tableLabel={t("trafficPage.chart.table", { count: samples.length })}
				timeLabel={t("trafficPage.chart.time")}
				height={height}
			/>
		</div>
	);
}

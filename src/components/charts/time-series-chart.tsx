"use client";

/**
 * Small dependency-free SVG time-series chart (status board, traffic).
 *
 * - Drawn at the width it is given on screen (measured), so text and strokes
 *   keep their size and nothing is stretched; until the first measurement it
 *   scales a 640-unit drawing proportionally.
 * - `null` values break the line (no sample, offline): gaps stay visible.
 * - Optional markers (e.g. failed probes) are drawn as ticks on the x axis
 *   instead of as values.
 * - Pointer and keyboard (←/→, Home/End) move a cursor with a readout; a
 *   collapsible data table carries the same numbers for screen readers.
 * - No animation, so `prefers-reduced-motion` needs no special case.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";

export type ChartPoint = { t: number; v: number | null };
export type ChartSeries = { key: string; label: string; color: string; points: ChartPoint[] };
export type ChartMarker = { t: number; label: string };

type Props = {
	ariaLabel: string;
	from: number;
	to: number;
	series: ChartSeries[];
	formatY: (value: number) => string;
	formatX: (time: number) => string;
	/** Fixed upper bound (e.g. 100 for percentages); otherwise derived from the data. */
	yMax?: number;
	markers?: ChartMarker[];
	markerLabel?: string;
	emptyLabel: string;
	tableLabel: string;
	timeLabel: string;
	height?: number;
};

/** Drawing width before the container has been measured (server render). */
const DEFAULT_WIDTH = 640;
const PAD_LEFT = 76;
const PAD_RIGHT = 12;
const PAD_TOP = 10;
const PAD_BOTTOM = 24;

function niceCeiling(value: number): number {
	if (value <= 0) return 1;
	const exponent = Math.floor(Math.log10(value));
	const base = 10 ** exponent;
	for (const step of [1, 2, 2.5, 5, 10]) {
		if (value <= step * base) return step * base;
	}
	return 10 * base;
}

export function TimeSeriesChart(props: Props) {
	const { ariaLabel, from, to, series, formatY, formatX, markers = [], emptyLabel, tableLabel, timeLabel, height = 180 } = props;
	const titleId = useId();
	const [cursor, setCursor] = useState<number | null>(null);
	const [tableOpen, setTableOpen] = useState(false);
	const frameRef = useRef<HTMLDivElement>(null);
	const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
	useEffect(() => {
		const frame = frameRef.current;
		if (!frame || typeof ResizeObserver === "undefined") return;
		const update = () => {
			const width = Math.round(frame.clientWidth);
			if (width > 0) setMeasuredWidth(width);
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(frame);
		return () => observer.disconnect();
	}, []);
	const drawWidth = measuredWidth ?? DEFAULT_WIDTH;

	const times = useMemo(() => {
		const set = new Set<number>();
		for (const s of series) for (const p of s.points) set.add(p.t);
		return [...set].sort((a, b) => a - b);
	}, [series]);
	const hasValues = series.some((s) => s.points.some((p) => p.v !== null));
	const dataMax = Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.v ?? 0)));
	const yMax = props.yMax ?? niceCeiling(dataMax * 1.1);
	const plotW = drawWidth - PAD_LEFT - PAD_RIGHT;
	const plotH = height - PAD_TOP - PAD_BOTTOM;
	const span = Math.max(1, to - from);
	const x = (t: number) => PAD_LEFT + ((t - from) / span) * plotW;
	const y = (v: number) => PAD_TOP + plotH - (Math.min(v, yMax) / yMax) * plotH;

	const segments = useMemo(
		() =>
			series.map((s) => {
				const parts: ChartPoint[][] = [];
				let current: ChartPoint[] = [];
				for (const point of s.points) {
					if (point.v === null) {
						if (current.length) parts.push(current);
						current = [];
					} else current.push(point);
				}
				if (current.length) parts.push(current);
				return { series: s, parts };
			}),
		[series],
	);

	const cursorTime = cursor === null ? null : times[cursor] ?? null;
	const readout = cursorTime === null
		? null
		: series.map((s) => ({ label: s.label, color: s.color, value: s.points.find((p) => p.t === cursorTime)?.v ?? null }));

	const moveCursor = (index: number) => setCursor(times.length === 0 ? null : Math.max(0, Math.min(times.length - 1, index)));
	const onKeyDown = (event: React.KeyboardEvent) => {
		if (times.length === 0) return;
		if (event.key === "ArrowRight") moveCursor((cursor ?? -1) + 1);
		else if (event.key === "ArrowLeft") moveCursor((cursor ?? times.length) - 1);
		else if (event.key === "Home") moveCursor(0);
		else if (event.key === "End") moveCursor(times.length - 1);
		else if (event.key === "Escape") setCursor(null);
		else return;
		event.preventDefault();
	};
	const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
		if (times.length === 0) return;
		const rect = event.currentTarget.getBoundingClientRect();
		const px = ((event.clientX - rect.left) / rect.width) * drawWidth;
		const t = from + ((px - PAD_LEFT) / plotW) * span;
		let best = 0;
		for (let i = 1; i < times.length; i++) if (Math.abs(times[i]! - t) < Math.abs(times[best]! - t)) best = i;
		setCursor(best);
	};

	const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
	const xTicks = [0, 1 / 3, 2 / 3, 1].map((f) => from + f * span);

	return (
		<figure className="min-w-0">
			<div ref={frameRef} className="relative">
				<svg
					viewBox={`0 0 ${drawWidth} ${height}`}
					width={measuredWidth ?? undefined}
					height={measuredWidth ? height : undefined}
					className={`block w-full touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${measuredWidth ? "" : "h-auto"}`}
					role="img"
					aria-labelledby={titleId}
					tabIndex={0}
					onKeyDown={onKeyDown}
					onPointerMove={onPointerMove}
					onPointerLeave={() => setCursor(null)}
					onBlur={() => setCursor(null)}
				>
					<title id={titleId}>{ariaLabel}</title>
					{ticks.map((tick) => (
						<g key={tick}>
							<line x1={PAD_LEFT} x2={drawWidth - PAD_RIGHT} y1={y(tick)} y2={y(tick)} stroke="var(--chart-grid, var(--border-subtle))" strokeWidth={1} />
							<text x={PAD_LEFT - 6} y={y(tick) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">{formatY(tick)}</text>
						</g>
					))}
					{xTicks.map((tick, index) => (
						<text key={tick} x={x(tick)} y={height - 6} textAnchor={index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"} fontSize={11} fill="var(--text-muted)">
							{formatX(tick)}
						</text>
					))}
					{segments.map(({ series: s, parts }) =>
						parts.map((part, index) =>
							part.length === 1 ? (
								<circle key={`${s.key}-${index}`} cx={x(part[0]!.t)} cy={y(part[0]!.v!)} r={2.5} fill={s.color} />
							) : (
								<polyline
									key={`${s.key}-${index}`}
									points={part.map((p) => `${x(p.t).toFixed(1)},${y(p.v!).toFixed(1)}`).join(" ")}
									fill="none"
									stroke={s.color}
									strokeWidth={1.75}
									strokeLinejoin="round"
									strokeLinecap="round"
								/>
							),
						),
					)}
					{markers.map((marker, index) => (
						<line key={`${marker.t}-${index}`} x1={x(marker.t)} x2={x(marker.t)} y1={PAD_TOP + plotH - 8} y2={PAD_TOP + plotH} stroke="var(--danger)" strokeWidth={2}>
							<title>{marker.label}</title>
						</line>
					))}
					{cursorTime !== null ? (
						<line x1={x(cursorTime)} x2={x(cursorTime)} y1={PAD_TOP} y2={PAD_TOP + plotH} stroke="var(--text-muted)" strokeDasharray="3 3" />
					) : null}
				</svg>
				{!hasValues ? (
					<p className="absolute inset-0 flex items-center justify-center text-sm text-[var(--text-muted)]">{emptyLabel}</p>
				) : null}
			</div>
			<figcaption className="mt-1 flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]" aria-live="polite">
				{readout && cursorTime !== null ? (
					<>
						<span className="font-mono text-[var(--text-muted)]">{formatX(cursorTime)}</span>
						{readout.map((item) => (
							<span key={item.label} className="inline-flex items-center gap-1.5">
								<span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: item.color }} />
								{item.label} <span className="font-mono">{item.value === null ? "—" : formatY(item.value)}</span>
							</span>
						))}
					</>
				) : (
					series.map((s) => (
						<span key={s.key} className="inline-flex items-center gap-1.5">
							<span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
							{s.label}
						</span>
					))
				)}
				{markers.length > 0 && props.markerLabel ? (
					<span className="inline-flex items-center gap-1.5">
						<span aria-hidden className="inline-block h-2.5 w-0.5 bg-[var(--danger)]" />
						{props.markerLabel}
					</span>
				) : null}
			</figcaption>
			<details className="mt-1 text-xs" onToggle={(event) => setTableOpen((event.currentTarget as HTMLDetailsElement).open)}>
				<summary className="cursor-pointer text-[var(--text-muted)]">{tableLabel}</summary>
				{tableOpen ? (
					<div className="mt-2 max-h-64 overflow-auto">
						<table className="w-full text-left">
							<thead>
								<tr>
									<th scope="col" className="pr-3 font-medium">{timeLabel}</th>
									{series.map((s) => (
										<th key={s.key} scope="col" className="pr-3 font-medium">{s.label}</th>
									))}
								</tr>
							</thead>
							<tbody>
								{times.map((time) => (
									<tr key={time}>
										<td className="pr-3 font-mono">{formatX(time)}</td>
										{series.map((s) => {
											const value = s.points.find((p) => p.t === time)?.v ?? null;
											return <td key={s.key} className="pr-3 font-mono">{value === null ? "—" : formatY(value)}</td>;
										})}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : null}
			</details>
		</figure>
	);
}

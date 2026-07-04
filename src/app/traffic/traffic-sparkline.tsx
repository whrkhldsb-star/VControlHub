"use client";

/**
 * Lightweight dual-line SVG sparkline for /traffic page.
 *
 * Why pure SVG (no recharts/chart.js):
 * - Zero new deps; tree-shake cost = 0 KB.
 * - The view is read-only, no zoom/pan/tooltip-on-hover needed.
 * - Data set is small (≤ 60 samples) — d3-scale would be overkill.
 *
 * Renders two stacked area+line series (rx + tx) on a shared time axis.
 * Heights are auto-scaled to max(rx,tx) so both series share the same
 * vertical reference and visual comparison is meaningful.
 */

export type TrafficSample = {
	/** Sample timestamp (ms since epoch). */
	t: number;
	/** RX rate in bytes/second. */
	rx: number;
	/** TX rate in bytes/second. */
	tx: number;
};

type Props = {
	samples: TrafficSample[];
	width?: number;
	height?: number;
	/** Bytes/sec formatter (e.g. reuse server-side label format). */
	formatRate?: (bytesPerSecond: number) => string;
	/** Localized labels. */
	labels?: {
		rx?: string;
		tx?: string;
		empty?: string;
		windowHint?: string;
	};
};

const DEFAULT_FORMAT = (bps: number): string => {
	if (!Number.isFinite(bps) || bps < 0) return "—";
	const units = ["B/s", "KB/s", "MB/s", "GB/s"];
	let v = bps;
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
};

export function TrafficSparkline({
	samples,
	width = 560,
	height = 140,
	formatRate = DEFAULT_FORMAT,
	labels = {},
}: Props) {
	const padL = 8;
	const padR = 8;
	const padT = 10;
	const padB = 18;

	if (samples.length < 2) {
		return (
			<div
				className="flex items-center justify-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--input-bg)] text-xs text-[var(--text-muted)]"
				style={{ height }}
				data-traffic-sparkline-empty
			>
				{labels.empty ?? "采集中…多个数据点后将显示走势"}
			</div>
		);
	}

	const maxRate = Math.max(
		...samples.map((s) => Math.max(s.rx, s.tx)),
		1, // avoid div-by-zero, also gives a tiny baseline for flat zero
	);
	const t0 = samples[0]!.t;
	const tN = samples[samples.length - 1]!.t;
	const span = Math.max(tN - t0, 1);
	const innerW = width - padL - padR;
	const innerH = height - padT - padB;

	const toX = (t: number) => padL + ((t - t0) / span) * innerW;
	const toY = (rate: number) =>
		padT + innerH - (rate / maxRate) * innerH;

	const rxLine = samples.map((s) => `${toX(s.t)},${toY(s.rx)}`).join(" ");
	const txLine = samples.map((s) => `${toX(s.t)},${toY(s.tx)}`).join(" ");
	const rxArea = `${padL},${padT + innerH} ${rxLine} ${toX(tN)},${padT + innerH}`;
	const txArea = `${padL},${padT + innerH} ${txLine} ${toX(tN)},${padT + innerH}`;

	const last = samples[samples.length - 1]!;
	const fmtTime = (ms: number) => {
		const d = new Date(ms);
		const hh = String(d.getHours()).padStart(2, "0");
		const mm = String(d.getMinutes()).padStart(2, "0");
		return `${hh}:${mm}`;
	};

	return (
		<div className="rounded-xl border border-[var(--border)] bg-[var(--input-bg)] p-3" data-traffic-sparkline>
			<div className="mb-2 flex items-center justify-between text-[11px]">
				<div className="flex items-center gap-3">
					<span className="inline-flex items-center gap-1.5 text-[var(--color-action)]">
						<span className="inline-block h-2 w-2 rounded-full bg-[var(--color-action-bg)]" />
						{labels.rx ?? "RX"} {formatRate(last.rx)}
					</span>
					<span className="inline-flex items-center gap-1.5 text-[var(--success)]">
						<span className="inline-block h-2 w-2 rounded-full bg-[var(--success)]" />
						{labels.tx ?? "TX"} {formatRate(last.tx)}
					</span>
				</div>
				<span className="text-[var(--text-muted)]">
					{labels.windowHint?.replace("{count}", String(samples.length)) ??
						`${samples.length} 个样本`}
				</span>
			</div>
			<svg
				viewBox={`0 0 ${width} ${height}`}
				preserveAspectRatio="none"
				className="block w-full"
				style={{ height }}
				role="img"
				aria-label={`Traffic trend chart, current RX ${formatRate(last.rx)}, TX ${formatRate(last.tx)}`}
			>
				{/* Horizontal grid: 3 lines (25%, 50%, 75%) */}
				{[0.25, 0.5, 0.75].map((p) => (
					<line
						key={p}
						x1={padL}
						x2={width - padR}
						y1={padT + innerH * p}
						y2={padT + innerH * p}
						stroke="rgba(255,255,255,0.06)"
						strokeWidth={1}
					/>
				))}
				{/* TX area+line (emerald) drawn under RX for layering */}
				<polygon
					points={txArea}
					fill="rgba(16, 185, 129, 0.12)"
				/>
				<polyline
					points={txLine}
					fill="none"
					stroke="rgb(52, 211, 153)"
					strokeWidth={1.5}
					strokeLinejoin="round"
				/>
				{/* RX area+line (cyan) on top */}
				<polygon
					points={rxArea}
					fill="rgba(34, 211, 238, 0.14)"
				/>
				<polyline
					points={rxLine}
					fill="none"
					stroke="rgb(103, 232, 249)"
					strokeWidth={1.5}
					strokeLinejoin="round"
				/>
				{/* Time labels at left/middle/right */}
				<text
					x={padL}
					y={height - 4}
					fontSize={10}
					fill="rgba(148, 163, 184, 0.6)"
				>
					{fmtTime(t0)}
				</text>
				{samples.length >= 4 && (
					<text
						x={padL + innerW / 2}
						y={height - 4}
						fontSize={10}
						textAnchor="middle"
						fill="rgba(148, 163, 184, 0.6)"
					>
						{fmtTime(samples[Math.floor(samples.length / 2)]!.t)}
					</text>
				)}
				<text
					x={width - padR}
					y={height - 4}
					fontSize={10}
					textAnchor="end"
					fill="rgba(148, 163, 184, 0.6)"
				>
					{fmtTime(tN)}
				</text>
			</svg>
		</div>
	);
}

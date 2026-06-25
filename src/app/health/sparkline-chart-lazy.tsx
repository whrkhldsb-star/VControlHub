/**
 * Dynamic wrapper around `SparklineChart`.
 *
 * TR-036: the per-server "trend" expansion only renders this SVG chart
 * after the user clicks the row. Routing it through `next/dynamic`
 * defers the chart's own chunk (and its `MetricPoint` type import,
 * plus all of the SVG path math) until that interaction. The stub
 * preserves vertical space so the row does not jump when the chart
 * arrives ~50ms later.
 *
 * `ssr: false` is correct: `SparklineChart` does not use any browser-
 * specific API today, but routing it through dynamic lets us swap in
 * a heavier charting lib later without re-touching the parent
 * dashboard. We pin the option so a future SVG ↔ canvas migration
 * can still get client-only semantics for free.
 *
 * Prop types are read via `ComponentProps<typeof import(...)>` — a
 * TypeScript-only construct that webpack does not follow, so the
 * real component is NOT pulled back into the parent chunk.
 */
"use client";

import dynamic from "next/dynamic";
import type { ComponentProps, ComponentType } from "react";

type SparklineChartProps = ComponentProps<
	typeof import("./sparkline-chart").SparklineChart
>;

function SparklineChartStub() {
	return (
		<div
			aria-hidden
			className="h-[220px] w-full animate-pulse rounded-lg bg-slate-800/40"
		/>
	);
}

export const SparklineChartLazy: ComponentType<SparklineChartProps> = dynamic(
	() =>
		import("./sparkline-chart").then((m) => m.SparklineChart),
	{ ssr: false, loading: () => <SparklineChartStub /> },
);

export type { SparklineChartProps } from "./sparkline-chart";

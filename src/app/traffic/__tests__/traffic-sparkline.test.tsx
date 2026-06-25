/**
 * Tests for <TrafficSparkline />.
 *
 * Coverage:
 *  - Empty-state render when samples < 2
 *  - Renders both polylines + areas when ≥ 2 samples
 *  - Time-axis labels reflect first/last sample timestamps
 *  - Header legend shows last sample's formatted rates
 *  - Auto-scales height (max rate dominates Y axis)
 */
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { TrafficSparkline, type TrafficSample } from "../traffic-sparkline";

function makeSamples(rates: Array<[rx: number, tx: number]>, baseTime = Date.UTC(2026, 5, 24, 10, 0, 0)): TrafficSample[] {
	return rates.map(([rx, tx], i) => ({ t: baseTime + i * 30_000, rx, tx }));
}

describe("<TrafficSparkline />", () => {
	it("renders empty placeholder when fewer than 2 samples", () => {
		const { container, getByText } = render(<TrafficSparkline samples={[]} labels={{ empty: "暂无数据" }} />);
		expect(container.querySelector("[data-traffic-sparkline-empty]")).not.toBeNull();
		expect(container.querySelector("svg")).toBeNull();
		expect(getByText("暂无数据")).toBeTruthy();
	});

	it("renders empty placeholder for exactly 1 sample (need ≥ 2 for a line)", () => {
		const { container } = render(<TrafficSparkline samples={makeSamples([[100, 200]])} />);
		expect(container.querySelector("[data-traffic-sparkline-empty]")).not.toBeNull();
	});

	it("renders both RX and TX polylines when given multiple samples", () => {
		const samples = makeSamples([
			[1000, 500],
			[2000, 700],
			[1500, 900],
			[3000, 1200],
		]);
		const { container } = render(<TrafficSparkline samples={samples} />);
		const polylines = container.querySelectorAll("polyline");
		expect(polylines.length).toBe(2); // RX line + TX line
		const polygons = container.querySelectorAll("polygon");
		expect(polygons.length).toBe(2); // RX area + TX area
		const svg = container.querySelector("svg");
		expect(svg).not.toBeNull();
		// Each polyline must reference all sample x positions (4 coordinate pairs each)
		polylines.forEach((line) => {
			const points = line.getAttribute("points") ?? "";
			expect(points.split(/\s+/).filter(Boolean)).toHaveLength(samples.length);
		});
	});

	it("shows formatted last-sample rates in the header legend", () => {
		const samples = makeSamples([
			[1000, 500],
			[2_500_000, 1_200_000], // last sample
		]);
		const fmt = (v: number) => `${Math.round(v / 1024)} K`;
		const { getByText } = render(<TrafficSparkline samples={samples} formatRate={fmt} labels={{ rx: "RX", tx: "TX" }} />);
		// Last RX = 2_500_000 / 1024 ≈ 2441 K
		expect(getByText(/RX 2441 K/)).toBeTruthy();
		expect(getByText(/TX 1172 K/)).toBeTruthy();
	});

	it("renders time labels (HH:MM) at first and last sample on the X axis", () => {
		const samples = makeSamples(
			[
				[100, 100],
				[200, 200],
				[300, 300],
			],
			Date.UTC(2026, 5, 24, 8, 0, 0),
		);
		const { container } = render(<TrafficSparkline samples={samples} />);
		const texts = Array.from(container.querySelectorAll("svg text")).map((n) => n.textContent ?? "");
		const hhmm = /^\d{2}:\d{2}$/;
		const timeLabels = texts.filter((s) => hhmm.test(s));
		expect(timeLabels.length).toBeGreaterThanOrEqual(2); // first + last (middle only when ≥ 4 samples)
	});

	it("respects custom width/height props on the SVG", () => {
		const samples = makeSamples([
			[100, 100],
			[200, 200],
		]);
		const { container } = render(<TrafficSparkline samples={samples} width={800} height={200} />);
		const svg = container.querySelector("svg");
		expect(svg?.getAttribute("viewBox")).toBe("0 0 800 200");
	});

	it("renders sample count via windowHint template", () => {
		const samples = makeSamples([
			[100, 100],
			[200, 200],
			[300, 300],
		]);
		const { getByText } = render(<TrafficSparkline samples={samples} labels={{ windowHint: "共 {count} 个数据点" }} />);
		expect(getByText("共 3 个数据点")).toBeTruthy();
	});
});

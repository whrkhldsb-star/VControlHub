import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { TrafficChart, formatTrafficRate, trafficAxisMax, type TrafficSample } from "../traffic-chart";

function makeSamples(rates: Array<[rx: number, tx: number]>, baseTime = Date.UTC(2026, 9, 21, 2, 0, 0)): TrafficSample[] {
	return rates.map(([rx, tx], i) => ({ t: baseTime + i * 5_000, rx, tx }));
}

describe("formatTrafficRate", () => {
	it("picks a unit and keeps about three significant digits", () => {
		expect(formatTrafficRate(0)).toBe("0 B/s");
		expect(formatTrafficRate(512)).toBe("512 B/s");
		expect(formatTrafficRate(1536)).toBe("1.50 KB/s");
		expect(formatTrafficRate(12.5 * 1024 * 1024)).toBe("12.5 MB/s");
		expect(formatTrafficRate(-1)).toBe("—");
	});
});

describe("trafficAxisMax", () => {
	it("rounds the axis in the unit its labels show", () => {
		expect(trafficAxisMax(13 * 1024)).toBe(20 * 1024);
		expect(trafficAxisMax(900)).toBe(1000);
		expect(trafficAxisMax(3.2 * 1024 * 1024)).toBe(5 * 1024 * 1024);
		expect(trafficAxisMax(0)).toBe(1);
	});
});

describe("<TrafficChart />", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("shows a placeholder until there are two samples", () => {
		const { container, getByText } = renderWithI18n(<TrafficChart samples={makeSamples([[1, 2]])} live />);
		expect(container.querySelector("[data-traffic-chart-empty]")).not.toBeNull();
		expect(container.querySelector("svg")).toBeNull();
		expect(getByText("采集中…多个数据点后将显示走势")).toBeInTheDocument();
	});

	it("draws download and upload in the rate badges' colours with a rate axis", () => {
		const { container, getAllByText } = renderWithI18n(<TrafficChart samples={makeSamples([[1024, 0], [4096, 2048], [2048, 1024]])} live />);
		const lines = Array.from(container.querySelectorAll("polyline"));
		expect(lines.map((line) => line.getAttribute("stroke"))).toEqual(["var(--accent)", "var(--success)"]);
		// The axis is labelled in rates; the old sparkline had no scale at all.
		expect(getAllByText(/KB\/s$/).length).toBeGreaterThan(0);
		expect(container.querySelector("svg")?.getAttribute("preserveAspectRatio")).toBeNull();
		expect(container.querySelector("svg title")?.textContent).toContain("最新下载 2.00 KB/s");
	});

	it("draws at the measured width instead of stretching a fixed drawing", () => {
		let notify: (() => void) | undefined;
		vi.stubGlobal("ResizeObserver", class {
			constructor(callback: () => void) { notify = callback; }
			observe() {}
			disconnect() {}
		});
		const widthSpy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1100);
		const { container } = renderWithI18n(<TrafficChart samples={makeSamples([[1, 1], [2, 2], [3, 3]])} height={200} />);
		notify?.();
		const svg = container.querySelector("svg")!;
		expect(svg.getAttribute("viewBox")).toBe("0 0 1100 200");
		expect(svg.getAttribute("width")).toBe("1100");
		expect(svg.getAttribute("height")).toBe("200");
		widthSpy.mockRestore();
	});
});

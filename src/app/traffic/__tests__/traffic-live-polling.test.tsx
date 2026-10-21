import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.fetch }));
vi.mock("@/lib/preferences/use-refresh-interval", () => ({ useRefreshInterval: () => 30 }));

import TrafficPage from "../traffic-page-client";

let tick = 0;
function iface(intervalSeconds: number) {
	tick += 1;
	return {
		iface: "eth0",
		rxBytes: 1000 * tick,
		txBytes: 500 * tick,
		rxLabel: "1 KB",
		txLabel: "0.5 KB",
		rxRateBytesPerSecond: 2048 * tick,
		txRateBytesPerSecond: 1024 * tick,
		rxRateLabel: `${2 * tick} KB/s`,
		txRateLabel: `${tick} KB/s`,
		intervalSeconds,
	};
}

const summaryCalls = () => mocks.fetch.mock.calls.filter(([url]) => url === "/api/traffic/summary").length;

describe("traffic live tab", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		tick = 0;
		mocks.fetch.mockReset();
		mocks.fetch.mockImplementation(async (url: string) => {
			if (url.startsWith("/api/traffic/summary?include=remote")) return { remoteServers: [] };
			if (url.startsWith("/api/traffic/history")) return { history: [] };
			// The first reading after a restart has no baseline: a 0 rate over 0 s.
			const primary = iface(summaryCalls() === 1 ? 0 : 5);
			return {
				timestamp: new Date().toISOString(),
				currentServer: { name: "hub", primaryInterface: primary, interfaces: [primary] },
				storageNodes: [],
				servers: [],
			};
		});
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("samples every 5 s, skips the baseline-less reading and stops on another tab", async () => {
		renderWithI18n(<TrafficPage />);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(summaryCalls()).toBe(1);
		// The first reading is skipped, so the chart still waits for data.
		expect(document.querySelector("[data-traffic-chart-empty]")).not.toBeNull();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});
		expect(summaryCalls()).toBe(3);
		expect(document.querySelector("[data-traffic-chart] svg")).not.toBeNull();
		expect(document.querySelectorAll("[data-traffic-chart] polyline")).toHaveLength(2);

		fireEvent.click(screen.getByRole("button", { name: "24h" }));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		const before = summaryCalls();
		// 10 s → 25 s: the 5 s cadence is gone; the page-wide 30 s refresh has not come yet.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(15_000);
		});
		expect(summaryCalls()).toBe(before);
	});
});

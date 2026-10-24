import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";

/**
 * With manual refresh, the page's Refresh button re-read the local summary
 * only: the remote readings and the 24 h / 7 d curve stayed as loaded.
 */
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.fetch }));
vi.mock("@/lib/preferences/use-refresh-interval", () => ({ useRefreshInterval: () => 0 }));

import TrafficPage from "../traffic-page-client";

const calls = (prefix: string) => mocks.fetch.mock.calls.filter(([url]) => String(url).startsWith(prefix)).length;

describe("traffic page refresh", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mocks.fetch.mockReset();
		mocks.fetch.mockImplementation(async (url: string) => {
			if (url.startsWith("/api/traffic/summary?include=remote")) return { remoteServers: [] };
			if (url.startsWith("/api/traffic/history")) return { history: [] };
			const primary = { iface: "eth0", rxBytes: 1, txBytes: 1, rxLabel: "1 B", txLabel: "1 B", rxRateBytesPerSecond: 1, txRateBytesPerSecond: 1, rxRateLabel: "1 B/s", txRateLabel: "1 B/s", intervalSeconds: 5 };
			return { timestamp: new Date().toISOString(), currentServer: { name: "hub", primaryInterface: primary, interfaces: [primary] }, storageNodes: [], servers: [] };
		});
	});
	afterEach(() => { vi.useRealTimers(); });

	it("re-reads the remote readings and the shown history too", async () => {
		renderWithI18n(<TrafficPage />);
		await act(async () => { await vi.advanceTimersByTimeAsync(0); });
		fireEvent.click(screen.getByRole("button", { name: "24h" }));
		await act(async () => { await vi.advanceTimersByTimeAsync(0); });
		const before = { remote: calls("/api/traffic/summary?include=remote"), history: calls("/api/traffic/history") };

		fireEvent.click(screen.getAllByRole("button", { name: /^(刷新|Refresh)$/ })[0]!);
		await act(async () => { await vi.advanceTimersByTimeAsync(0); });

		expect(calls("/api/traffic/summary?include=remote")).toBe(before.remote + 1);
		expect(calls("/api/traffic/history")).toBe(before.history + 1);
	});
});

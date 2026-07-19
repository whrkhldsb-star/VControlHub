/**
 * useHealthData — pure-logic hook tests.
 * Verifies the fetch sequencing, error state, history merge, and the
 * auto-refresh interval contract. Network calls are mocked via
 * `csrfFetch`; timers use vi.useFakeTimers so the interval test stays
 * deterministic.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useHealthData } from "../use-health-data";

const csrfFetchMock = vi.fn();

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: (...args: unknown[]) => csrfFetchMock(...args),
}));

vi.mock("@/lib/preferences/refresh-interval", () => ({
	getRefreshIntervalFromStorage: () => 5,
}));

const sampleOverview = {
	total: 2,
	online: 2,
	warning: 0,
	critical: 0,
	offline: 0,
	servers: [
		{
			serverId: "srv_1",
			serverName: "node-1",
			host: "10.0.0.1",
			enabled: true,
			status: "healthy",
			lastCheck: "2026-06-14T00:00:00Z",
		},
	],
};

const sampleSystemHealth = {
	generatedAt: "2026-06-14T00:00:00Z",
	summary: { total: 1, healthy: 1, warning: 0, critical: 0, overall: "healthy" as const },
	checks: [],
};

describe("useHealthData", () => {
	beforeEach(() => {
		csrfFetchMock.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("fires the initial overview + system-health fetch on mount", async () => {
		csrfFetchMock
			.mockResolvedValueOnce(sampleOverview)
			.mockResolvedValueOnce(sampleSystemHealth);
		const { result } = renderHook(() =>
			useHealthData({ browserLocale: "zh-CN", locale: "zh" }),
		);
		await waitFor(() => {
			expect(csrfFetchMock).toHaveBeenCalledWith("/api/health");
			expect(csrfFetchMock).toHaveBeenCalledWith("/api/system-health");
		});
		await waitFor(() => {
			expect(result.current.overview).toEqual(sampleOverview);
			expect(result.current.systemHealth).toEqual(sampleSystemHealth);
		});
		expect(result.current.isRefreshing).toBe(false);
	});

	it("captures load errors without dropping the previous overview", async () => {
		csrfFetchMock
			.mockResolvedValueOnce(sampleOverview)
			.mockResolvedValueOnce(sampleSystemHealth)
			.mockRejectedValueOnce(new Error("network down"));
		const { result } = renderHook(() =>
			useHealthData({ browserLocale: "en-US", locale: "en" }),
		);
		await waitFor(() => expect(result.current.overview).toEqual(sampleOverview));
		await act(async () => {
			await result.current.fetchHealth();
		});
		expect(result.current.overview).toEqual(sampleOverview); // unchanged
		expect(result.current.loadError).toBe("network down");
	});

	it("falls back to translated error when fetch throws a non-Error", async () => {
		csrfFetchMock
			.mockResolvedValueOnce(sampleOverview)
			.mockResolvedValueOnce(sampleSystemHealth)
			.mockRejectedValueOnce("string-error");
		const { result } = renderHook(() =>
			useHealthData({ browserLocale: "zh-CN", locale: "zh" }),
		);
		await waitFor(() => expect(result.current.overview).toEqual(sampleOverview));
		await act(async () => {
			await result.current.fetchHealth();
		});
		expect(result.current.loadError).toBe("加载健康状态失败");
	});

	it("merges fetchHistory into the per-server history map and clears the prior error", async () => {
		csrfFetchMock
			.mockResolvedValueOnce(sampleOverview)
			.mockResolvedValueOnce(sampleSystemHealth)
			.mockResolvedValueOnce({ history: [{ cpu: 10, mem: 20, disk: 30, online: true, t: "t" }] });
		const { result } = renderHook(() =>
			useHealthData({ browserLocale: "en-US", locale: "en" }),
		);
		await waitFor(() => expect(result.current.overview).toEqual(sampleOverview));
		await act(async () => {
			await result.current.fetchHistory("srv_1");
		});
		expect(result.current.history.srv_1).toHaveLength(1);
		expect(result.current.historyErrors.srv_1).toBeUndefined();
	});

	it("captures per-server history errors with the translated message", async () => {
		csrfFetchMock
			.mockResolvedValueOnce(sampleOverview)
			.mockResolvedValueOnce(sampleSystemHealth)
			.mockRejectedValueOnce(new Error("boom"));
		const { result } = renderHook(() =>
			useHealthData({ browserLocale: "en-US", locale: "en" }),
		);
		await waitFor(() => expect(result.current.overview).toEqual(sampleOverview));
		await act(async () => {
			await result.current.fetchHistory("srv_2");
		});
		expect(result.current.historyErrors.srv_2).toBe("boom");
	});

	it("runs the auto-refresh interval and re-fetches on each tick", async () => {
		vi.useFakeTimers();
		csrfFetchMock
			.mockResolvedValueOnce(sampleOverview)
			.mockResolvedValueOnce(sampleSystemHealth)
			.mockResolvedValueOnce(sampleOverview)
			.mockResolvedValueOnce(sampleSystemHealth)
			.mockResolvedValueOnce(sampleOverview)
			.mockResolvedValueOnce(sampleSystemHealth);
		renderHook(() =>
			useHealthData({ browserLocale: "en-US", locale: "en" }),
		);
		// Initial fetch (deferred via setTimeout 0).
		await vi.advanceTimersByTimeAsync(0);
		expect(csrfFetchMock).toHaveBeenCalledTimes(2);
		// First auto-refresh tick at 5s (mocked interval).
		await vi.advanceTimersByTimeAsync(5000);
		expect(csrfFetchMock).toHaveBeenCalledTimes(4);
		// Second auto-refresh tick.
		await vi.advanceTimersByTimeAsync(5000);
		expect(csrfFetchMock).toHaveBeenCalledTimes(6);
	});

	it("ignores non-system-health payloads in fetchSystemHealth", async () => {
		csrfFetchMock
			.mockResolvedValueOnce(sampleOverview)
			.mockResolvedValueOnce({ generatedAt: 123, summary: null, checks: "nope" });
		const { result } = renderHook(() =>
			useHealthData({ browserLocale: "en-US", locale: "en" }),
		);
		await waitFor(() => expect(result.current.overview).toEqual(sampleOverview));
		await act(async () => {
			await result.current.fetchSystemHealth();
		});
		// System-health stays null because the payload failed the type guard.
		expect(result.current.systemHealth).toBeNull();
	});

	it("uses the initial system-health report when provided", () => {
		csrfFetchMock.mockReset();
		const { result } = renderHook(() =>
			useHealthData({
				browserLocale: "en-US",
				locale: "en",
				initialSystemHealth: sampleSystemHealth,
			}),
		);
		expect(result.current.systemHealth).toEqual(sampleSystemHealth);
	});

	it("mode=system only hits /api/system-health", async () => {
		csrfFetchMock.mockResolvedValueOnce(sampleSystemHealth);
		renderHook(() =>
			useHealthData({ browserLocale: "zh-CN", locale: "zh", mode: "system" }),
		);
		await waitFor(() => {
			expect(csrfFetchMock).toHaveBeenCalledWith("/api/system-health");
		});
		expect(csrfFetchMock).not.toHaveBeenCalledWith("/api/health");
	});

	it("mode=vps only hits /api/health", async () => {
		csrfFetchMock.mockResolvedValueOnce(sampleOverview);
		renderHook(() =>
			useHealthData({ browserLocale: "zh-CN", locale: "zh", mode: "vps" }),
		);
		await waitFor(() => {
			expect(csrfFetchMock).toHaveBeenCalledWith("/api/health");
		});
		expect(csrfFetchMock).not.toHaveBeenCalledWith("/api/system-health");
	});

});

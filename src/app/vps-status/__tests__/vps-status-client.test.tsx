import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useHealthDataMock = vi.fn();

vi.mock("@/app/health/use-health-data", () => ({
	useHealthData: (...args: unknown[]) => useHealthDataMock(...args),
}));

vi.mock("@/app/health/capacity-forecast-panel", () => ({
	CapacityForecastPanel: () => <div data-testid="capacity-forecast" />,
}));

vi.mock("@/app/health/sparkline-chart-lazy", () => ({
	SparklineChartLazy: () => <div data-testid="sparkline" />,
}));

import { VpsStatusClient } from "../vps-status-client";
import { I18nProvider } from "@/lib/i18n/provider";

function wrap(ui: React.ReactElement) {
	return <I18nProvider initialLocale="zh">{ui}</I18nProvider>;
}

const sampleOverview = {
	total: 2,
	online: 1,
	warning: 1,
	critical: 0,
	offline: 0,
	servers: [
		{
			serverId: "srv_1",
			serverName: "HK Prod",
			host: "10.0.0.1",
			enabled: true,
			status: "healthy" as const,
			lastCheck: "2026-07-19T00:00:00.000Z",
			cpu: 12,
			mem: 40,
			diskMax: 55,
			loadAvg1m: 0.4,
			networkInKbps: 1_000,
			networkOutKbps: 500,
			uptime: "1 day",
		},
		{
			serverId: "srv_2",
			serverName: "US Edge",
			host: "10.0.0.2",
			enabled: true,
			status: "warning" as const,
			lastCheck: "2026-07-19T00:00:00.000Z",
			cpu: 88,
			mem: 70,
			diskMax: 60,
			loadAvg1m: 2.1,
			networkInKbps: 2_000,
			networkOutKbps: 800,
			uptime: "1 hour",
		},
	],
};

describe("VpsStatusClient", () => {
	beforeEach(() => {
		useHealthDataMock.mockReset();
		useHealthDataMock.mockReturnValue({
			overview: sampleOverview,
			systemHealth: null,
			history: {},
			historyErrors: {},
			loadError: null,
			lastRefresh: "2026-07-19 00:00:00",
			isRefreshing: false,
			autoRefresh: true,
			refreshIntervalSeconds: 60,
			fetchHealth: vi.fn(),
			fetchSystemHealth: vi.fn(),
			fetchHistory: vi.fn(),
			setAutoRefresh: vi.fn(),
		});
	});

	it("renders Komari/Nezha-style fleet cards from overview data", () => {
		render(wrap(<VpsStatusClient serverCount={2} />));
		// Name appears in both fleet summary top-N and card title.
		expect(screen.getAllByText("HK Prod").length).toBeGreaterThan(0);
		expect(screen.getAllByText("US Edge").length).toBeGreaterThan(0);
		expect(useHealthDataMock).toHaveBeenCalledWith(
			expect.objectContaining({ mode: "vps" }),
		);
	});

	it("filters to abnormal nodes only", async () => {
		const user = userEvent.setup();
		render(wrap(<VpsStatusClient serverCount={2} />));
		await user.click(screen.getByRole("button", { name: "异常" }));
		// Healthy node card disappears; warning node remains (possibly still in summary).
		// Card title for healthy should be gone from the grid filter result.
		const remaining = screen.queryAllByText("HK Prod");
		// After issue filter, healthy card is hidden; summary may still list averages only.
		// Accept either 0 cards or residual summary references.
		expect(screen.getAllByText("US Edge").length).toBeGreaterThan(0);
		// Ensure filter button is active by checking healthy host text is reduced.
		expect(remaining.length).toBeLessThanOrEqual(1);
	});
});

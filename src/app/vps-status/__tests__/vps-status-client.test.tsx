import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { I18nProvider } from "@/lib/i18n/provider";
import { VpsStatusClient } from "../vps-status-client";

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));

vi.mock("@/app/health/capacity-forecast-panel", () => ({
	CapacityForecastPanel: () => <div data-testid="capacity-forecast" />,
}));

vi.mock("@/app/health/sparkline-chart-lazy", () => ({
	SparklineChartLazy: () => <div data-testid="sparkline" />,
}));

const overview = {
	total: 2,
	online: 1,
	warning: 1,
	critical: 0,
	offline: 0,
	servers: [
		{
			serverId: "srv_1",
			serverName: "HK Prod",
			host: "203.0.113.10",
			enabled: true,
			status: "healthy" as const,
			cpu: 12.3,
			mem: 45.6,
			diskMax: 67.8,
			loadAvg1m: 0.4,
			networkInKbps: 1000,
			networkOutKbps: 500,
			uptime: "3 days",
			lastCheck: "2026-05-25T00:00:00.000Z",
		},
		{
			serverId: "srv_2",
			serverName: "US Edge",
			host: "203.0.113.20",
			enabled: true,
			status: "warning" as const,
			cpu: 88,
			mem: 70,
			diskMax: 60,
			loadAvg1m: 2.1,
			networkInKbps: 2000,
			networkOutKbps: 800,
			uptime: "1 hour",
			lastCheck: "2026-05-25T00:00:00.000Z",
		},
	],
};

function renderVps(locale: "zh" | "en" = "zh") {
	return render(
		<I18nProvider initialLocale={locale}>
			<VpsStatusClient serverCount={2} />
		</I18nProvider>,
	);
}

describe("VpsStatusClient (split fleet surface)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.localStorage.clear();
		vi.useRealTimers();
		vi.mocked(csrfFetch).mockImplementation(async (input) => {
			const url = String(input);
			if (url.includes("/api/health?") || url.includes("history")) {
				return { history: [] };
			}
			return overview;
		});
	});

	it("renders Komari/Nezha-style fleet cards and hits /api/health only", async () => {
		renderVps();
		expect((await screen.findAllByText("HK Prod")).length).toBeGreaterThan(0);
		expect((await screen.findAllByText("US Edge")).length).toBeGreaterThan(0);
		await waitFor(() => {
			expect(csrfFetch).toHaveBeenCalledWith("/api/health");
		});
		expect(csrfFetch).not.toHaveBeenCalledWith("/api/system-health");
	});

	it("surfaces overview load failures instead of a blank board", async () => {
		vi.mocked(csrfFetch).mockRejectedValue(new Error("健康检查接口不可用"));
		renderVps();
		expect(await screen.findByRole("alert")).toHaveTextContent("健康检查接口不可用");
	});

	it("filters to abnormal nodes", async () => {
		const user = userEvent.setup();
		renderVps();
		expect((await screen.findAllByText("HK Prod")).length).toBeGreaterThan(0);
		await user.click(screen.getByRole("button", { name: "异常" }));
		expect(screen.getAllByText("US Edge").length).toBeGreaterThan(0);
		// Healthy card title should drop from the grid (summary may still mention averages only).
		expect(screen.queryAllByText("HK Prod").length).toBeLessThanOrEqual(1);
	});

	it("shows a history load error while keeping the node card expanded", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockImplementation(async (input) => {
			const url = String(input);
			if (url.includes("history") || (url.includes("/api/health?") && url.includes("serverId"))) {
				throw new Error("历史指标读取失败");
			}
			return overview;
		});
		renderVps();
		expect((await screen.findAllByText("HK Prod")).length).toBeGreaterThan(0);
		const trendButtons = screen.getAllByRole("button", { name: /趋势|Trend/i });
		await user.click(trendButtons[0]!);
		await waitFor(() => {
			expect(screen.getAllByText(/历史指标读取失败/).length).toBeGreaterThan(0);
		});
	});

	it("honours the Settings refresh interval", async () => {
		window.localStorage.setItem("vps-preferences", JSON.stringify({ autoRefreshInterval: 60 }));
		const setIntervalSpy = vi.spyOn(window, "setInterval");
		renderVps();
		expect((await screen.findAllByText("HK Prod")).length).toBeGreaterThan(0);
		expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
	});

	it("uses 44px touch targets on the refresh control", async () => {
		renderVps();
		expect((await screen.findAllByText("HK Prod")).length).toBeGreaterThan(0);
		const refresh = screen.getByRole("button", { name: "刷新健康状态" });
		expect(refresh.className).toContain("min-h-11");
	});
});

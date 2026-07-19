import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useHealthDataMock = vi.fn();

vi.mock("../use-health-data", () => ({
	useHealthData: (...args: unknown[]) => useHealthDataMock(...args),
}));

vi.mock("../active-incidents-banner", () => ({
	ActiveIncidentsBanner: () => <div data-testid="incidents-banner" />,
}));

import { SystemHealthClient } from "../system-health-client";
import { I18nProvider } from "@/lib/i18n/provider";

function wrap(ui: React.ReactElement) {
	return <I18nProvider initialLocale="zh">{ui}</I18nProvider>;
}

describe("SystemHealthClient", () => {
	beforeEach(() => {
		useHealthDataMock.mockReset();
		useHealthDataMock.mockReturnValue({
			overview: null,
			systemHealth: {
				generatedAt: "2026-07-19T00:00:00.000Z",
				summary: { total: 2, healthy: 1, warning: 1, critical: 0, overall: "warning" },
				checks: [
					{
						id: "db",
						label: "Database",
						status: "healthy",
						message: "ok",
						messageCode: "healthy",
					},
				],
			},
			history: {},
			historyErrors: {},
			loadError: null,
			lastRefresh: "2026-07-19 00:00:00",
			isRefreshing: false,
			autoRefresh: true,
			refreshIntervalSeconds: 30,
			fetchHealth: vi.fn(),
			fetchSystemHealth: vi.fn(),
			fetchHistory: vi.fn(),
			setAutoRefresh: vi.fn(),
		});
	});

	it("renders self-check section without fleet server names", () => {
		render(wrap(<SystemHealthClient />));
		expect(screen.getByTestId("incidents-banner")).toBeInTheDocument();
		// Self-check heading is present; fleet hostnames are not.
		expect(document.body.textContent).toMatch(/自检|Self-check|repair|修复/i);
		expect(screen.queryByText("HK Prod")).not.toBeInTheDocument();
	});

	it("requests system-mode health data only", () => {
		render(wrap(<SystemHealthClient />));
		expect(useHealthDataMock).toHaveBeenCalledWith(
			expect.objectContaining({ mode: "system" }),
		);
	});
});

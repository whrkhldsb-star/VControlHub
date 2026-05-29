import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { HealthDashboardClient } from "../health-dashboard-client";

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));

const overview = {
	total: 1,
	online: 1,
	warning: 0,
	critical: 0,
	offline: 0,
	servers: [
		{
			serverId: "srv_1",
			serverName: "HK Prod",
			host: "203.0.113.10",
			enabled: true,
			status: "healthy",
			cpu: 12.3,
			mem: 45.6,
			diskMax: 67.8,
			uptime: "3 days",
			lastCheck: "2026-05-25T00:00:00.000Z",
		},
	],
};

describe("HealthDashboardClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
		vi.mocked(csrfFetch).mockResolvedValue(overview);
	});

	it("surfaces health overview load failures instead of rendering a blank panel", async () => {
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("健康检查接口不可用"));

		render(<HealthDashboardClient serverCount={1} />);

		expect(await screen.findByRole("alert")).toHaveTextContent("健康检查接口不可用");
		expect(screen.getByRole("button", { name: "重试加载健康状态" })).toBeEnabled();
		expect(screen.queryByText("节点总数")).not.toBeInTheDocument();
	});

	it("keeps the last overview visible when manual refresh fails", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch)
			.mockResolvedValueOnce(overview)
			.mockRejectedValueOnce(new Error("刷新健康状态失败"));

		render(<HealthDashboardClient serverCount={1} />);

		expect(await screen.findByText("HK Prod")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "刷新健康状态" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("刷新健康状态失败");
		expect(screen.getByText("HK Prod")).toBeInTheDocument();
	});

	it("shows a history load error while keeping the server row expanded", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch)
			.mockResolvedValueOnce(overview)
			.mockRejectedValueOnce(new Error("历史指标读取失败"));

		render(<HealthDashboardClient serverCount={1} />);

		expect(await screen.findByText("HK Prod")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "趋势 ▼" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("历史指标读取失败");
		expect(screen.getByRole("button", { name: "收起 ▲" })).toBeInTheDocument();
	});

	it("shows current VControlHub service units in repair guidance", async () => {
		render(
			<HealthDashboardClient
				serverCount={1}
				systemHealthSummary={{ total: 4, healthy: 3, warning: 0, critical: 0, overall: "healthy" }}
			/>,
		);

		expect(await screen.findByText("HK Prod")).toBeInTheDocument();
		expect(screen.getByText(/vcontrolhub-next\.service \/ vcontrolhub-ssh-ws\.service \/ caddy\.service/)).toBeInTheDocument();
		expect(screen.queryByText(/whrkhldsb-next\.service/)).not.toBeInTheDocument();
		expect(screen.queryByText(/whrkhldsb-ssh-ws\.service/)).not.toBeInTheDocument();
	});
});

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
		window.localStorage.clear();
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
				initialSystemHealth={{
					generatedAt: "2026-05-30T00:00:00.000Z",
					summary: { total: 4, healthy: 3, warning: 0, critical: 0, overall: "healthy" },
					checks: [
						{ id: "next-service", label: "Next.js 服务", status: "healthy", message: "vcontrolhub-next.service 正在运行" },
					],
				}}
			/>,
		);

		expect(await screen.findByText("HK Prod")).toBeInTheDocument();
		expect(screen.getByText(/vcontrolhub-next\.service \/ vcontrolhub-ssh-ws\.service \/ caddy\.service/)).toBeInTheDocument();
		expect(screen.queryByText(/whrkhldsb-next\.service/)).not.toBeInTheDocument();
		expect(screen.queryByText(/whrkhldsb-ssh-ws\.service/)).not.toBeInTheDocument();
	});

	it("uses the saved global refresh interval instead of a fixed 30 second timer", async () => {
		window.localStorage.setItem("vps-preferences", JSON.stringify({ autoRefreshInterval: 60 }));
		const setIntervalSpy = vi.spyOn(window, "setInterval");
		vi.mocked(csrfFetch).mockResolvedValue(overview);

		render(<HealthDashboardClient serverCount={1} />);
		expect(await screen.findByText("HK Prod")).toBeInTheDocument();

		expect(screen.getByText("每 1分钟")).toBeInTheDocument();
		expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
		expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 30_000);
	});

	it("disables health auto-refresh when the global refresh preference is manual", async () => {
		window.localStorage.setItem("vps-preferences", JSON.stringify({ autoRefreshInterval: 0 }));
		const setIntervalSpy = vi.spyOn(window, "setInterval");
		vi.mocked(csrfFetch).mockResolvedValue(overview);

		render(<HealthDashboardClient serverCount={1} />);
		expect(await screen.findByText("HK Prod")).toBeInTheDocument();

		expect(screen.getByText("已关闭")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "切换健康状态自动刷新" })).toBeDisabled();
		expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 30_000);
		expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 60_000);
	});

	it("refreshes system self-check details through the system-health API", async () => {
		vi.mocked(csrfFetch)
			.mockResolvedValueOnce(overview)
			.mockResolvedValueOnce({
				generatedAt: "2026-05-30T00:00:00.000Z",
				summary: { total: 2, healthy: 1, warning: 1, critical: 0, overall: "warning" },
				checks: [
					{ id: "database", label: "数据库连接", status: "healthy", message: "数据库可查询" },
					{ id: "git-sync", label: "GitHub 同步状态", status: "warning", message: "本地与远端不一致" },
				],
			});

		render(<HealthDashboardClient serverCount={1} />);

		expect(await screen.findByText("HK Prod")).toBeInTheDocument();
		expect(csrfFetch).toHaveBeenCalledWith("/api/health");
		expect(csrfFetch).toHaveBeenCalledWith("/api/system-health");
		expect(screen.getByText("2 项检查 · 1 正常 · 1 警告 · 0 严重")).toBeInTheDocument();
		expect(screen.getByText("GitHub 同步状态")).toBeInTheDocument();
		expect(screen.getByText("本地与远端不一致")).toBeInTheDocument();
	});
});

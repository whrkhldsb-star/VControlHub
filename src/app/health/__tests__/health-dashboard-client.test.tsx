import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { I18nProvider } from "@/lib/i18n/provider";
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

const renderHealthDashboard = (locale: "zh" | "en" = "zh", props: React.ComponentProps<typeof HealthDashboardClient> = { serverCount: 1 }) => render(
	<I18nProvider initialLocale={locale}>
		<HealthDashboardClient {...props} />
	</I18nProvider>,
);

describe("HealthDashboardClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.localStorage.clear();
		vi.useRealTimers();
		vi.mocked(csrfFetch).mockImplementation(async (input) => {
			const url = String(input);
			if (url.includes("/api/announcements")) return { announcements: [] };
			return overview;
		});
	});

	it("surfaces health overview load failures instead of rendering a blank panel", async () => {
		vi.mocked(csrfFetch).mockImplementation(async (input) => {
			const url = String(input);
			if (url.includes("/api/announcements")) return { announcements: [] };
			throw new Error("健康检查接口不可用");
		});

		renderHealthDashboard();

		expect(await screen.findByRole("alert")).toHaveTextContent("健康检查接口不可用");
		expect(screen.getByRole("button", { name: "重试加载健康状态" })).toBeEnabled();
		expect(screen.queryByText("节点总数")).not.toBeInTheDocument();
	});

	it("keeps the last overview visible when manual refresh fails", async () => {
		const user = userEvent.setup();
		let callCount = 0;
		vi.mocked(csrfFetch).mockImplementation(async (input) => {
			const url = String(input);
			if (url.includes("/api/announcements")) return { announcements: [] };
			callCount++;
			if (callCount > 2) throw new Error("刷新健康状态失败");
			return overview;
		});

		renderHealthDashboard();

		expect(await screen.findByText("HK Prod")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "刷新健康状态" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("刷新健康状态失败");
		expect(screen.getByText("HK Prod")).toBeInTheDocument();
	});

	it("shows a history load error while keeping the server row expanded", async () => {
		const user = userEvent.setup();
		let callCount = 0;
		vi.mocked(csrfFetch).mockImplementation(async (input) => {
			const url = String(input);
			if (url.includes("/api/announcements")) return { announcements: [] };
			callCount++;
			if (callCount > 2) throw new Error("历史指标读取失败");
			return overview;
		});

		renderHealthDashboard();

		expect(await screen.findByText("HK Prod")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "趋势 ▼" }));

		await waitFor(() => {
			expect(screen.getByText(/历史指标读取失败/)).toBeInTheDocument();
		});
		expect(screen.getByRole("button", { name: "收起 ▲" })).toBeInTheDocument();
	});

	it("shows current VControlHub service units in repair guidance", async () => {
		renderHealthDashboard("zh", {
			serverCount: 1,
			initialSystemHealth: {
				generatedAt: "2026-05-30T00:00:00.000Z",
				summary: { total: 4, healthy: 3, warning: 0, critical: 0, overall: "healthy" },
				checks: [
					{ id: "next-service", label: "Next.js 服务", status: "healthy", message: "vcontrolhub-next.service 正在运行", params: { unit: "vcontrolhub-next.service" }, messageCode: "running" },
				],
			},
		});

		expect(await screen.findByText("HK Prod")).toBeInTheDocument();
		expect(screen.getByText(/vcontrolhub-next\.service \/ vcontrolhub-ssh-ws\.service \/ caddy\.service/)).toBeInTheDocument();
		expect(screen.queryByText(/whrkhldsb-next\.service/)).not.toBeInTheDocument();
		expect(screen.queryByText(/whrkhldsb-ssh-ws\.service/)).not.toBeInTheDocument();
	});

	it("uses the saved global refresh interval instead of a fixed 30 second timer", async () => {
		window.localStorage.setItem("vps-preferences", JSON.stringify({ autoRefreshInterval: 60 }));
		const setIntervalSpy = vi.spyOn(window, "setInterval");
		vi.mocked(csrfFetch).mockResolvedValue(overview);

		renderHealthDashboard();
		expect(await screen.findByText("HK Prod")).toBeInTheDocument();

		expect(screen.getByText("每 1 minutes")).toBeInTheDocument();
		expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
		expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 30_000);
	});

	it("disables health auto-refresh when the global refresh preference is manual", async () => {
		window.localStorage.setItem("vps-preferences", JSON.stringify({ autoRefreshInterval: 0 }));
		const setIntervalSpy = vi.spyOn(window, "setInterval");
		vi.mocked(csrfFetch).mockResolvedValue(overview);

		renderHealthDashboard();
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
					{ id: "database", label: "数据库连接", status: "healthy", message: "数据库可查询", messageCode: "healthy" },
					{ id: "git-sync", label: "GitHub 同步状态", status: "warning", message: "本地与远端不一致", params: { head: "abc", remote: "def" }, messageCode: "differs" },
				],
			});

		renderHealthDashboard();

		expect(await screen.findByText("HK Prod")).toBeInTheDocument();
		expect(csrfFetch).toHaveBeenCalledWith("/api/health");
		expect(csrfFetch).toHaveBeenCalledWith("/api/system-health");
		expect(screen.getByText("2 项检查 · 1 正常 · 1 警告 · 0 严重")).toBeInTheDocument();
		expect(screen.getByText("GitHub 同步状态")).toBeInTheDocument();
		expect(screen.getByText(/abc.*不一致/)).toBeInTheDocument();
	});

	// TR-022 mobile overflow guards: status row, repair grid, and touch
	// targets must follow the project's mobile-first responsive contract so
	// the dashboard is usable on small viewports. These assertions catch
	// regressions where a future edit reintroduces desktop-only widths,
	// hover-only overlays, or sub-44px tap targets.
	it("stacks the status/refresh row and the self-check header on mobile so they do not horizontally overflow", async () => {
		renderHealthDashboard("zh", {
			serverCount: 1,
			initialSystemHealth: {
				generatedAt: "2026-05-30T00:00:00.000Z",
				summary: { total: 3, healthy: 2, warning: 1, critical: 0, overall: "warning" },
				checks: [
					{ id: "next-service", label: "Next.js 服务", status: "healthy", message: "vcontrolhub-next.service 正在运行", params: { unit: "vcontrolhub-next.service" }, messageCode: "running" },
				],
			},
		});

		expect(await screen.findByText("HK Prod")).toBeInTheDocument();

		// Last refresh + refresh button + auto-refresh switch sit in a single
		// flex row at sm+. On mobile they must stack instead of overflowing
		// the 375px viewport.
		const refreshButton = screen.getByRole("button", { name: "刷新健康状态" });
		const row = refreshButton.parentElement?.parentElement as HTMLElement;
		expect(row).toBeTruthy();
		const rowTokens = row.className.split(/\s+/);
		expect(rowTokens).toContain("flex-col");
		expect(rowTokens).toContain("sm:flex-row");
		expect(rowTokens).toContain("gap-3");

		// The self-check header has a long Chinese title plus two link
		// buttons ("看审计日志" / "回到首页"); on mobile the link buttons
		// must wrap below the title instead of overflowing.
		const auditLink = screen.getByRole("link", { name: "看审计日志" });
		const headerRow = auditLink.parentElement?.parentElement as HTMLElement;
		expect(headerRow).toBeTruthy();
		const headerTokens = headerRow.className.split(/\s+/);
		expect(headerTokens).toContain("flex-col");
		expect(headerTokens).toContain("sm:flex-row");
		expect(headerTokens).toContain("sm:items-center");
		expect(headerTokens).toContain("sm:justify-between");
	});

	it("uses 44px touch targets for the refresh and auto-refresh controls", async () => {
		renderHealthDashboard();

		expect(await screen.findByText("HK Prod")).toBeInTheDocument();

		const refreshButton = screen.getByRole("button", { name: "刷新健康状态" });
		expect(refreshButton.className).toContain("min-h-11");

		const autoRefreshToggle = screen.getByRole("button", { name: "切换健康状态自动刷新" });
		// The toggle is a small visual switch; the touch target must still
		// reach 44px in both axes, so it has to expose min-h-11 min-w-11
		// (typically via a wrapper / extra padding) even though the visible
		// pill is only 16x32.
		expect(autoRefreshToggle.className).toMatch(/min-h-11/);
		expect(autoRefreshToggle.className).toMatch(/min-w-11/);
	});

	it("scales summary card values and uses a 2-column repair grid on tablet", async () => {
		renderHealthDashboard("zh", {
			serverCount: 1,
			initialSystemHealth: {
				generatedAt: "2026-05-30T00:00:00.000Z",
				summary: { total: 3, healthy: 2, warning: 1, critical: 0, overall: "warning" },
				checks: [
					{ id: "next-service", label: "Next.js 服务", status: "healthy", message: "vcontrolhub-next.service 正在运行", params: { unit: "vcontrolhub-next.service" }, messageCode: "running" },
				],
			},
		});

		expect(await screen.findByText("HK Prod")).toBeInTheDocument();

		// SummaryCard value must stay readable on mobile (text-2xl) but
		// grow on desktop (sm:text-3xl) to match the dashboard's data
		// density. We assert via the wrapper <article data-card>.
		const totalCard = screen.getByText("节点总数").parentElement as HTMLElement;
		const valueNode = totalCard.querySelector("div.text-2xl, div.sm\\:text-3xl") as HTMLElement;
		expect(valueNode).toBeTruthy();
		const valueTokens = valueNode.className.split(/\s+/);
		expect(valueTokens).toContain("text-2xl");
		expect(valueTokens).toContain("sm:text-3xl");

		// Repair suggestions: 1 column on mobile, 2 on tablet, 3 on desktop.
		const repairCopy = screen.getByText("修复建议");
		const repairSection = repairCopy.closest("section") as HTMLElement;
		const repairGrid = repairSection.querySelector(".grid.lg\\:grid-cols-3") as HTMLElement;
		expect(repairGrid).toBeTruthy();
		const repairTokens = repairGrid.className.split(/\s+/);
		expect(repairTokens).toContain("grid-cols-1");
		expect(repairTokens).toContain("sm:grid-cols-2");
		expect(repairTokens).toContain("lg:grid-cols-3");
	});

	it("localizes nested system health and overview controls in English", async () => {
		vi.mocked(csrfFetch)
			.mockResolvedValueOnce(overview)
			.mockResolvedValueOnce({
				generatedAt: "2026-05-30T00:00:00.000Z",
				summary: { total: 2, healthy: 1, warning: 1, critical: 0, overall: "warning" },
				checks: [
					{ id: "database", label: "数据库连接", status: "healthy", message: "数据库可查询", messageCode: "healthy" },
					{ id: "git-sync", label: "GitHub 同步状态", status: "warning", message: "当前提交 abc123，远端状态暂不可确认", params: { head: "abc123" }, messageCode: "no-remote" },
				],
			});

		renderHealthDashboard("en");

		expect(await screen.findByText("HK Prod")).toBeInTheDocument();
		expect(screen.getByText("System Self-check")).toBeInTheDocument();
		expect(screen.getByText("2 checks · 1 healthy · 1 warnings · 0 critical")).toBeInTheDocument();
		expect(screen.getByText("Database Connection")).toBeInTheDocument();
		expect(screen.getByText("Database is queryable")).toBeInTheDocument();
		expect(screen.getByText("GitHub Sync Status")).toBeInTheDocument();
		expect(screen.getByText("Current commit abc123; remote status is temporarily unavailable")).toBeInTheDocument();
		expect(screen.getByText("Total Nodes")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Refresh health status" })).toBeInTheDocument();
		expect(screen.getByText("Auto refresh")).toBeInTheDocument();
		expect(screen.queryByText("系统自检")).not.toBeInTheDocument();
		expect(screen.queryByText("节点总数")).not.toBeInTheDocument();
	});
});

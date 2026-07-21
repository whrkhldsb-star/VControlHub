import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { I18nProvider } from "@/lib/i18n/provider";
import { SystemHealthClient } from "../system-health-client";

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));

vi.mock("../active-incidents-banner", () => ({
	ActiveIncidentsBanner: () => <div data-testid="incidents-banner" />,
}));

const systemHealth = {
	generatedAt: "2026-05-30T00:00:00.000Z",
	summary: { total: 2, healthy: 1, warning: 1, critical: 0, overall: "warning" as const },
	checks: [
		{
			id: "database",
			label: "数据库连接",
			status: "healthy" as const,
			message: "数据库可查询",
			messageCode: "healthy",
		},
		{
			id: "git-sync",
			label: "GitHub 同步状态",
			status: "warning" as const,
			message: "本地与远端不一致",
			params: { head: "abc", remote: "def" },
			messageCode: "differs",
		},
	],
};

function renderSystem(locale: "zh" | "en" = "zh", initial = systemHealth) {
	return render(
		<I18nProvider initialLocale={locale}>
			<SystemHealthClient initialSystemHealth={initial} />
		</I18nProvider>,
	);
}

describe("SystemHealthClient (split health surface)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.localStorage.clear();
		vi.useRealTimers();
		vi.mocked(csrfFetch).mockResolvedValue(systemHealth);
	});

	it("surfaces system-health load failures with a retry control", async () => {
		vi.mocked(csrfFetch).mockRejectedValue(new Error("健康检查接口不可用"));
		render(
			<I18nProvider initialLocale="zh">
				<SystemHealthClient initialSystemHealth={null} />
			</I18nProvider>,
		);
		expect(await screen.findByRole("alert")).toHaveTextContent("健康检查接口不可用");
		expect(screen.getByRole("button", { name: /重试|Retry/i })).toBeEnabled();
	});

	it("does not expose VPS-style refresh / auto-refresh controls on the system surface", async () => {
		renderSystem();
		expect(await screen.findByText("GitHub 同步状态")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "刷新健康状态" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "切换健康状态自动刷新" })).not.toBeInTheDocument();
		expect(screen.queryByText("自动刷新")).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: /VPS|舰队|Fleet|状态/i })).toBeInTheDocument();
	});

	it("loads system-health through the system-health API only", async () => {
		render(
			<I18nProvider initialLocale="zh">
				<SystemHealthClient initialSystemHealth={null} />
			</I18nProvider>,
		);
		await waitFor(() => {
			expect(csrfFetch).toHaveBeenCalledWith("/api/system-health");
		});
		expect(csrfFetch).not.toHaveBeenCalledWith("/api/health");
		expect(await screen.findByText(/2 项检查|2 checks/)).toBeInTheDocument();
	});

	it("does not start an auto-refresh interval on the system surface", async () => {
		window.localStorage.setItem("vps-preferences", JSON.stringify({ autoRefreshInterval: 60 }));
		const setIntervalSpy = vi.spyOn(window, "setInterval");
		renderSystem();
		expect(await screen.findByText("GitHub 同步状态")).toBeInTheDocument();
		expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 60_000);
		expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 30_000);
	});

	it("stacks the header row on mobile without a refresh toolbar", async () => {
		renderSystem();
		expect(await screen.findByText("GitHub 同步状态")).toBeInTheDocument();
		const auditLink = screen.getByRole("link", { name: /审计|Audit/i });
		const headerRow = auditLink.parentElement?.parentElement as HTMLElement;
		const headerTokens = headerRow.className.split(/\s+/);
		expect(headerTokens).toContain("flex-col");
		expect(headerTokens).toContain("sm:flex-row");
		const vpsLink = screen.getByRole("link", { name: /VPS|舰队|Fleet|状态/i });
		const topRow = vpsLink.parentElement?.parentElement as HTMLElement;
		const topTokens = topRow.className.split(/\s+/);
		expect(topTokens).toContain("flex-col");
		expect(topTokens).toContain("sm:flex-row");
	});

	it("localizes system self-check in English", async () => {
		render(
			<I18nProvider initialLocale="en">
				<SystemHealthClient
					initialSystemHealth={{
						generatedAt: "2026-05-30T00:00:00.000Z",
						summary: { total: 2, healthy: 1, warning: 1, critical: 0, overall: "warning" },
						checks: [
							{
								id: "database",
								label: "数据库连接",
								status: "healthy",
								message: "数据库可查询",
								messageCode: "healthy",
							},
							{
								id: "git-sync",
								label: "GitHub 同步状态",
								status: "warning",
								message: "当前提交 abc123，远端状态暂不可确认",
								params: { head: "abc123" },
								messageCode: "no-remote",
							},
						],
					}}
				/>
			</I18nProvider>,
		);
		expect(await screen.findByText("System Self-check")).toBeInTheDocument();
		expect(screen.getByText("2 checks · 1 healthy · 1 warnings · 0 critical")).toBeInTheDocument();
		expect(screen.getByText("Database Connection")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Refresh health status" })).not.toBeInTheDocument();
		expect(screen.queryByText("系统自检")).not.toBeInTheDocument();
	});

	it("does not render per-VPS fleet hostnames on the system surface", async () => {
		renderSystem();
		expect(await screen.findByText("GitHub 同步状态")).toBeInTheDocument();
		expect(screen.queryByText("HK Prod")).not.toBeInTheDocument();
		expect(screen.queryByText("节点总数")).not.toBeInTheDocument();
	});
});

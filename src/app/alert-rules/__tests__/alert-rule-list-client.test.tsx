import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/toast-provider";
import { AlertRuleListClient } from "../alert-rule-list-client";

vi.mock("@/lib/auth/require-session", () => ({
	requireSession: vi.fn(async () => ({ userId: "admin", role: "admin", permissions: ["notification:manage"] })),
}));
vi.mock("@/lib/auth/authorization", () => ({
	sessionHasPermission: vi.fn(() => true),
}));
vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));
vi.mock("@/lib/alert/service", () => ({
	listAlertRules: vi.fn(async () => [{
		id: "rule1",
		name: "Webhook rule",
		metric: "cpu_usage",
		operator: "gte",
		threshold: 90,
		durationSeconds: 0,
		serverIds: [],
		notifyChannels: ["webhook"],
		webhookUrl: "https://hooks.example.com/path/secret-token",
		cooldownMinutes: 10,
		enabled: true,
		lastTriggeredAt: null,
		createdAt: new Date("2026-01-01T00:00:00Z"),
	}]),
}));
vi.mock("@/lib/server/service", () => ({
	listServerProfiles: vi.fn(async () => []),
}));

import AlertRulesPage from "../page";
import { csrfFetch } from "@/lib/auth/csrf-client";

function wrap(ui: React.ReactElement) {
	return <ToastProvider>{ui}</ToastProvider>;
}

describe("alert rules client", () => {
	it("submits new alert rules to the API instead of only closing the form", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockResolvedValueOnce({ rules: [] });

		render(wrap(<AlertRuleListClient rules={[]} servers={[]} canManage={true} />));

		await user.click(screen.getByRole("button", { name: "+ 创建告警规则" }));
		await user.type(screen.getByLabelText("规则名称"), "CPU 过载告警");
		await user.clear(screen.getByLabelText("阈值"));
		await user.type(screen.getByLabelText("阈值"), "91");
		await user.click(screen.getByRole("button", { name: "创建规则" }));

		await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith(
			"/api/alert-rules",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({
					name: "CPU 过载告警",
					metric: "cpu_usage",
					operator: "gte",
					threshold: 91,
					notifyChannels: ["in_app"],
					cooldownMinutes: 30,
					webhookUrl: undefined,
				}),
			}),
		));
	});

	it("does not render full webhook URLs from serialized rule metadata", () => {
		render(wrap(<AlertRuleListClient
			rules={[{
				id: "rule1",
				name: "Webhook rule",
				metric: "cpu_usage",
				operator: "gte",
				threshold: 90,
				durationSeconds: 0,
				serverIds: [],
				notifyChannels: ["webhook"],
				webhookConfigured: true,
				cooldownMinutes: 10,
				enabled: true,
				lastTriggeredAt: null,
				createdAt: "2026-01-01T00:00:00.000Z",
			}]}
			servers={[]}
			canManage={true}
		/>));

		expect(screen.getByText("Webhook rule")).toBeInTheDocument();
		expect(screen.getByText("Webhook 已配置")).toBeInTheDocument();
		expect(screen.queryByText(/secret-token/)).not.toBeInTheDocument();
	});

	it("redacts webhook URLs before passing server-rendered rules to the client", async () => {
		const page = await AlertRulesPage();
		render(wrap(page));

		await waitFor(() => expect(screen.getByText("Webhook rule")).toBeInTheDocument());
		expect(screen.getByText("Webhook 已配置")).toBeInTheDocument();
		expect(screen.queryByText(/secret-token/)).not.toBeInTheDocument();
	});

	it("surfaces alert rule toggle failures and keeps the rule unchanged", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("告警规则更新失败"));

		render(wrap(<AlertRuleListClient rules={[{
			id: "rule1",
			name: "CPU overload",
			metric: "cpu_usage",
			operator: "gte",
			threshold: 90,
			durationSeconds: 0,
			serverIds: [],
			notifyChannels: ["in_app"],
			webhookConfigured: false,
			cooldownMinutes: 10,
			enabled: true,
			lastTriggeredAt: null,
			createdAt: "2026-01-01T00:00:00.000Z",
		}]} servers={[]} canManage={true} />));

		await user.click(screen.getByRole("button", { name: "暂停" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("告警规则更新失败");
		expect(screen.getByText("CPU overload")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "暂停" })).toBeEnabled();
	});

	it("surfaces alert rule delete failures and keeps the rule visible", async () => {
		const user = userEvent.setup();
		vi.spyOn(window, "confirm").mockReturnValue(true);
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("告警规则删除失败"));

		render(wrap(<AlertRuleListClient rules={[{
			id: "rule1",
			name: "Disk full",
			metric: "disk_usage",
			operator: "gte",
			threshold: 95,
			durationSeconds: 0,
			serverIds: [],
			notifyChannels: ["in_app"],
			webhookConfigured: false,
			cooldownMinutes: 10,
			enabled: true,
			lastTriggeredAt: null,
			createdAt: "2026-01-01T00:00:00.000Z",
		}]} servers={[]} canManage={true} />));

		await user.click(screen.getByRole("button", { name: "删除" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("告警规则删除失败");
		expect(screen.getByText("Disk full")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "删除" })).toBeEnabled();
	});

	it("surfaces immediate alert check failures", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("检测任务启动失败"));

		render(wrap(<AlertRuleListClient rules={[]} servers={[]} canManage={true} />));

		await user.click(screen.getByRole("button", { name: "🔍 立即检测" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("检测任务启动失败");
		expect(screen.getByRole("button", { name: "🔍 立即检测" })).toBeEnabled();
	});
});

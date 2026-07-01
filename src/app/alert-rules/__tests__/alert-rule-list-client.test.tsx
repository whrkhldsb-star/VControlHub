import { beforeEach, describe, expect, it, vi } from "vitest";
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
		silenceWindows: ["22:00-08:00"],
		enabled: true,
		lastTriggeredAt: null,
		createdAt: new Date("2026-01-01T00:00:00Z"),
	}]),
}));
vi.mock("@/lib/server/service", () => ({
	listServerProfiles: vi.fn(async () => []),
}));
vi.mock("@/lib/playbook/service", () => ({
	listPlaybooks: vi.fn(async () => []),
}));
vi.mock("@/lib/i18n/translations", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/i18n/translations")>();
	return {
		...actual,
		getServerLocale: vi.fn(async () => "zh" as const),
	};
});

import AlertRulesPage from "../page";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { I18nProvider } from "@/lib/i18n/provider";

function wrap(ui: React.ReactElement) {
	return (
		<I18nProvider initialLocale="zh">
			<ToastProvider>{ui}</ToastProvider>
		</I18nProvider>
	);
}

describe("alert rules client", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.mocked(csrfFetch).mockReset();
	});

	it("submits new alert rules to the API instead of only closing the form", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockResolvedValueOnce({ rules: [] });

		render(wrap(<AlertRuleListClient rules={[]} servers={[]} canManage={true} />));

		await user.click(screen.getByRole("button", { name: "+ 创建告警规则" }));
		await user.type(screen.getByLabelText("规则名称"), "CPU 过载告警");
		await user.clear(screen.getByLabelText("阈值"));
		await user.type(screen.getByLabelText("阈值"), "91");
		await user.type(screen.getByLabelText("静默期"), "22:00-08:00");
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
					durationSeconds: 0,
					serverIds: [],
					playbookIds: [],
					notifyChannels: ["in_app"],
					cooldownMinutes: 30,
					silenceWindows: ["22:00-08:00"],
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

	it("uses an in-app confirmation before deleting an alert rule", async () => {
		const user = userEvent.setup();
		const nativeConfirm = vi.spyOn(window, "confirm");
		vi.mocked(csrfFetch).mockResolvedValueOnce({ rules: [] });

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

		expect(nativeConfirm).not.toHaveBeenCalled();
		expect(screen.getByRole("dialog", { name: "删除告警规则" })).toHaveTextContent("Disk full");
		expect(csrfFetch).not.toHaveBeenCalled();

		await user.click(screen.getByRole("button", { name: "取消" }));
		expect(screen.queryByRole("dialog", { name: "删除告警规则" })).not.toBeInTheDocument();
		expect(csrfFetch).not.toHaveBeenCalled();

		await user.click(screen.getByRole("button", { name: "删除" }));
		await user.click(screen.getByRole("button", { name: "确认删除" }));

		await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/alert-rules?id=rule1", { method: "DELETE" }));
	});

	it("surfaces alert rule delete failures and keeps the rule visible", async () => {
		const user = userEvent.setup();
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
		await user.click(screen.getByRole("button", { name: "确认删除" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("告警规则删除失败");
		expect(screen.getAllByText("Disk full").length).toBeGreaterThan(0);
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

	it("can send a test alert for a configured rule and display delivery results", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockResolvedValueOnce({
			deliveries: [{ channel: "webhook", status: "sent", message: "Webhook 测试请求已发送" }],
		});

		render(wrap(<AlertRuleListClient rules={[{
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
		}]} servers={[]} canManage={true} />));

		await user.click(screen.getByRole("button", { name: "测试发送" }));

		await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith(
			"/api/alert-rules",
			expect.objectContaining({
				method: "PATCH",
				body: JSON.stringify({ testId: "rule1" }),
			}),
		));
		expect(await screen.findByRole("status")).toHaveTextContent("测试发送结果：Webhook rule");
		expect(screen.getByText("Webhook 测试请求已发送")).toBeInTheDocument();
	});

	it("surfaces alert test-send failures", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("Webhook 不可达"));

		render(wrap(<AlertRuleListClient rules={[{
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
		}]} servers={[]} canManage={true} />));

		await user.click(screen.getByRole("button", { name: "测试发送" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("Webhook 不可达");
		expect(screen.getByRole("button", { name: "测试发送" })).toBeEnabled();
	});
});

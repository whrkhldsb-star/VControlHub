import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnifiedSettingsPageClient } from "../unified-settings-page-client";
import { renderWithI18n as renderWithLocale } from "@/lib/i18n/__tests__/test-helpers";

const render = (ui: React.ReactElement) => renderWithLocale(ui, { locale: "zh" });

const refreshMock = vi.fn();

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: refreshMock }),
}));

import { csrfFetch } from "@/lib/auth/csrf-client";

const runtimeDefaults = {
	"runtime.commandExecutionTimeoutMs": "300000",
	"runtime.commandOutputLimitBytes": "262144",
	"runtime.commandStaleRunningAfterMs": "600000",
	"runtime.commandExecutionHeartbeatMs": "60000",
	"runtime.commandReconcileIntervalMs": "60000",
	"runtime.sftpSyncDirectoryTimeoutMs": "60000",
	"runtime.sshWsHeartbeatIntervalMs": "25000",
	"runtime.sshIdleTimeoutSec": "0",
	"runtime.operationTaskListLimit": "100",
	"runtime.aiProviderListLimit": "100",
	"runtime.aiConversationListLimit": "200",
};

const serverPrefs = {
	defaultPage: "/",
	dashboardWidgets: ["quick-links", "analytics", "audit-log"],
	notificationsEnabled: true,
	notificationSound: true,
	autoRefreshInterval: 30,
	autoProbeEnabled: true,
	autoProbeIntervalSec: 60,
};

describe("UnifiedSettingsPageClient", () => {
	beforeEach(() => {
		vi.mocked(csrfFetch).mockReset();
		refreshMock.mockReset();
		localStorage.clear();
		vi.useRealTimers();
		vi.mocked(csrfFetch).mockImplementation(async (url, init) => {
			if (String(url) === "/api/preferences") {
				return init ? serverPrefs : serverPrefs;
			}
			if (String(url) === "/api/settings") {
				return { success: true };
			}
			return {};
		});
	});

	it("combines personal preferences and admin system settings into one categorized settings page", async () => {
		render(
			<UnifiedSettingsPageClient
				settings={{ "platform.name": "VControlHub", "platform.logo": "", ...runtimeDefaults }}
				canManage
			/>,
		);

		expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
		expect(screen.getByText("个人使用习惯、界面行为、账户安全与平台级参数集中在一个入口中管理。"))
			.toBeInTheDocument();
		expect(screen.getByText("个性化设置")).toBeInTheDocument();
		const categoryNav = screen.getByRole("navigation", { name: "设置分类导航" });
		expect(categoryNav).toBeInTheDocument();
		expect(categoryNav).toHaveAttribute("data-card");
		expect(screen.getByRole("button", { name: "全部展开" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "全部折叠" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /个人偏好/ })).toHaveAttribute("href", "#personal-preferences");
		expect(screen.getByRole("link", { name: /默认页面/ })).toHaveAttribute("href", "#preferences-default-page");
		expect(screen.getByRole("link", { name: /平台信息/ })).toHaveAttribute("href", "#platform");
		expect(await screen.findByRole("button", { name: "服务器管理" })).toBeInTheDocument();
		const defaultPageSection = screen.getByRole("heading", { name: "默认页面" }).closest("section");
		expect(defaultPageSection).toHaveAttribute("id", "preferences-default-page");
		expect(defaultPageSection).toHaveAttribute("data-card");
		expect(within(defaultPageSection!).getByText("个人偏好")).toBeInTheDocument();
		expect(within(defaultPageSection!).getByText("登录后入口")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: /运行参数/ })).toBeInTheDocument();
	});

	it("keeps preference saves separate from platform setting saves inside the unified page", async () => {
		const user = userEvent.setup();
		render(
			<UnifiedSettingsPageClient
				settings={{ "platform.name": "旧名称", "platform.logo": "", ...runtimeDefaults }}
				canManage
			/>,
		);

		await user.click(await screen.findByRole("button", { name: "服务器管理" }));
		expect(await screen.findByRole("status")).toHaveTextContent("设置已保存");
		expect(csrfFetch).toHaveBeenCalledWith("/api/preferences", expect.objectContaining({
			method: "PUT",
			body: expect.stringContaining('"defaultPage":"/servers"'),
		}));

		const input = screen.getByLabelText("平台名称");
		await user.clear(input);
		await user.type(input, "新平台名称");
		const platformSection = screen.getByRole("heading", { name: /平台信息/ }).closest("section");
		await user.click(within(platformSection!).getByRole("button", { name: "保存" }));

		await waitFor(() => {
			expect(csrfFetch).toHaveBeenCalledWith("/api/settings", expect.objectContaining({
				method: "PATCH",
				body: JSON.stringify({ "platform.name": "新平台名称", "platform.logo": "" }),
			}));
		});
	});

	it("shows non-admin operators their personal preferences without system setting edit controls", async () => {
		render(<UnifiedSettingsPageClient settings={{}} canManage={false} />);

		expect(await screen.findByRole("button", { name: "仪表盘" })).toBeInTheDocument();
		expect(screen.getByRole("switch", { name: "启用通知" })).toBeInTheDocument();
		expect(screen.getByText("当前角色无系统设置权限")).toBeInTheDocument();
		expect(screen.queryByLabelText("平台名称")).not.toBeInTheDocument();
		expect(screen.getByText("个性化设置")).toBeInTheDocument();
	});
});

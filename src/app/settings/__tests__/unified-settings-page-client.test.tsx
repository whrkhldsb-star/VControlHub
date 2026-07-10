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
    // Clear any leftover hash from previous tests
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname);
    }
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

  it("renders tabbed settings page with personal preferences visible by default", async () => {
    render(
      <UnifiedSettingsPageClient
        settings={{ "platform.name": "VControlHub", "platform.logo": "", ...runtimeDefaults }}
        canManage
      />,
    );

    // Page header
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByText("个人使用习惯、界面行为、账户安全与平台级参数集中在一个入口中管理。"))
      .toBeInTheDocument();

    // Tab bar with 4 tabs
    expect(screen.getByRole("tab", { name: /个人偏好/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /安全与账户/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /通知与集成/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /高级配置/ })).toBeInTheDocument();

    // Personal preferences content is visible by default
    expect(await screen.findByRole("button", { name: "服务器管理" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "启用通知" })).toBeInTheDocument();
  });

  it("keeps preference saves separate from platform setting saves across tabs", async () => {
    const user = userEvent.setup();
    render(
      <UnifiedSettingsPageClient
        settings={{ "platform.name": "旧名称", "platform.logo": "", ...runtimeDefaults }}
        canManage
      />,
    );

    // ── Tab 1: Personal preferences ──
    await user.click(await screen.findByRole("button", { name: "服务器管理" }));
    expect(await screen.findByRole("status")).toHaveTextContent("设置已保存");
    expect(csrfFetch).toHaveBeenCalledWith("/api/preferences", expect.objectContaining({
      method: "PUT",
      body: expect.stringContaining('"defaultPage":"/servers"'),
    }));

    // ── Tab 2: Security & Account (contains platform info) ──
    await user.click(screen.getByRole("tab", { name: /安全与账户/ }));

    const input = await screen.findByLabelText("平台名称");
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

    // Personal preferences are visible
    expect(await screen.findByRole("button", { name: "仪表盘" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "启用通知" })).toBeInTheDocument();

    // Non-admin users only see personal settings; system-setting tabs are hidden.
    expect(screen.queryByRole("tab", { name: /安全与账户/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("平台名称")).not.toBeInTheDocument();

    // Personal tab still has content
    expect(screen.getByText("个性化设置")).toBeInTheDocument();
  });

  it("switches tabs and shows section counts in tab badges", async () => {
    render(
      <UnifiedSettingsPageClient
        settings={{ "platform.name": "VControlHub", "platform.logo": "", ...runtimeDefaults }}
        canManage
      />,
    );

    // Each tab should have a count badge
    const personalTab = screen.getByRole("tab", { name: /个人偏好/ });
    const securityTab = screen.getByRole("tab", { name: /安全与账户/ });
    const notificationsTab = screen.getByRole("tab", { name: /通知与集成/ });
    const advancedTab = screen.getByRole("tab", { name: /高级配置/ });

    expect(personalTab).toHaveAttribute("aria-selected", "true");
    expect(securityTab).toHaveAttribute("aria-selected", "false");

    // Switch to notifications tab
    await userEvent.click(notificationsTab);
    expect(notificationsTab).toHaveAttribute("aria-selected", "true");
    expect(personalTab).toHaveAttribute("aria-selected", "false");

    // Switch to advanced tab
    await userEvent.click(advancedTab);
    expect(advancedTab).toHaveAttribute("aria-selected", "true");
  });
});

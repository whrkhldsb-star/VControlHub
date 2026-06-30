import fs from "node:fs";
import path from "node:path";

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsClient } from "../settings-client";
import { renderWithI18n as renderWithLocale } from "@/lib/i18n/__tests__/test-helpers";

// Wrap with I18nProvider (zh default) so `t(key)` resolves to the original
// Chinese strings these assertions still expect — without it, t(key) returns
// the key itself and `getByLabelText("平台名称")` would fail because the
// rendered label would be "settingsPage.fields.platformName".
const render = (ui: React.ReactElement) => renderWithLocale(ui, { locale: "zh" });

const refreshMock = vi.fn();

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: refreshMock }),
}));

import { csrfFetch } from "@/lib/auth/csrf-client";

describe("SettingsClient", () => {
	beforeEach(() => {
		vi.mocked(csrfFetch).mockReset();
		refreshMock.mockReset();
	});

	it("persists edited settings through the settings API", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockResolvedValueOnce({ success: true });

		render(<SettingsClient settings={{ "platform.name": "旧名称", "platform.logo": "" }} canManage />);
		const input = screen.getByLabelText("平台名称");
		await user.clear(input);
		await user.type(input, "新平台名称");
		await user.click(screen.getAllByRole("button", { name: "保存" })[0]!);

		await waitFor(() => {
			expect(csrfFetch).toHaveBeenCalledWith("/api/settings", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ "platform.name": "新平台名称", "platform.logo": "" }),
			});
		});
		expect(await screen.findByText(/✓ 设置已保存/)).toBeInTheDocument();
		expect(screen.getByText(/平台信息已保存/)).toBeInTheDocument();
	});

	it("validates platform settings before calling the API", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockResolvedValueOnce({ success: true });

		render(<SettingsClient settings={{ "platform.name": "旧名称", "platform.logo": "ftp://example.com/logo.png" }} canManage />);
		await user.click(screen.getAllByRole("button", { name: "保存" })[0]!);

		expect(screen.getByText("Logo URL 只支持 http(s) 或站内路径")).toBeInTheDocument();
		expect(csrfFetch).not.toHaveBeenCalled();
	});

	it("shows API errors instead of falsely reporting success", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("权限不足"));

		render(<SettingsClient settings={{ "platform.name": "旧名称", "platform.logo": "" }} canManage />);
		await user.click(screen.getAllByRole("button", { name: "保存" })[0]!);

		expect(await screen.findByText("权限不足")).toBeInTheDocument();
		expect(screen.queryByText(/✓ 设置已保存/)).not.toBeInTheDocument();
	});

  it("persists edited runtime settings through the settings API", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockResolvedValueOnce({ success: true });

    render(<SettingsClient settings={{ "runtime.commandExecutionTimeoutMs": "300000", "runtime.commandOutputLimitBytes": "262144", "runtime.commandStaleRunningAfterMs": "600000", "runtime.commandExecutionHeartbeatMs": "60000", "runtime.commandReconcileIntervalMs": "60000", "runtime.sftpSyncDirectoryTimeoutMs": "60000", "runtime.sshWsHeartbeatIntervalMs": "25000", "runtime.sshIdleTimeoutSec": "600", "runtime.operationTaskListLimit": "100", "runtime.aiProviderListLimit": "100", "runtime.aiConversationListLimit": "200" }} canManage />);
    await user.clear(screen.getByLabelText("命令执行超时（毫秒）"));
    await user.type(screen.getByLabelText("命令执行超时（毫秒）"), "120000");
    // runtime.commandExecutionTimeoutMs is a high-risk field, so Save opens the confirm modal
    await user.click(screen.getAllByRole("button", { name: "保存" })[2]!);
    await screen.findByTestId("high-risk-confirm-modal");
    await user.click(screen.getByRole("button", { name: "确认保存" }));

    await waitFor(() => {
      expect(csrfFetch).toHaveBeenCalledWith("/api/settings", expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          "runtime.commandExecutionTimeoutMs": "120000",
          "runtime.commandOutputLimitBytes": "262144",
          "runtime.commandStaleRunningAfterMs": "600000",
          "runtime.commandExecutionHeartbeatMs": "60000",
          "runtime.commandReconcileIntervalMs": "60000",
          "runtime.sftpSyncDirectoryTimeoutMs": "60000",
          "runtime.sshWsHeartbeatIntervalMs": "25000",
          "runtime.sshIdleTimeoutSec": "600",
          "runtime.operationTaskListLimit": "100",
          "runtime.aiProviderListLimit": "100",
          "runtime.aiConversationListLimit": "200",
        }),
      }));
    });
  });

  it("keeps runtime setting labels visible and grouped for visual usability", () => {
    render(<SettingsClient settings={{}} canManage />);

    const runtimeSection = screen.getByRole("heading", { name: /运行参数/ }).closest("section");
    expect(runtimeSection).toHaveAttribute("id", "runtime");
    expect(runtimeSection?.querySelector(".md\\:grid-cols-2")).not.toBeNull();

    const commandTimeout = screen.getByLabelText("命令执行超时（毫秒）");
    const fieldCard = commandTimeout.parentElement;
    expect(fieldCard).toHaveClass("rounded-lg");
    expect(fieldCard).toHaveClass("border");
  });

  it("surfaces SSH terminal settings via the new idle-timeout dropdown in the admin Settings UX", () => {
    render(<SettingsClient settings={{}} canManage />);

    // The WS heartbeat stays as a numeric input; the SSH idle timeout is now a select.
    expect(screen.getByLabelText("SSH WebSocket 心跳间隔（毫秒，需重启）")).toHaveValue(25000);
    const idleSelect = screen.getByLabelText("SSH 空闲超时") as HTMLSelectElement;
    expect(idleSelect.tagName).toBe("SELECT");
    expect(idleSelect.value).toBe("0");
    expect(screen.getByText(/SSH 终端连接保活参数需要重启对应服务后生效/)).toBeInTheDocument();
    expect(screen.getByText(/只要浏览器页面还开着、网络和目标 SSH 仍可用，系统不会因为空闲主动断开/)).toBeInTheDocument();
  });

  it("surfaces Operation Tasks and AI list limits as immediately applied runtime settings", () => {
    render(<SettingsClient settings={{}} canManage />);

    expect(screen.getByLabelText("任务中心列表上限（条）")).toHaveValue(100);
    expect(screen.getByLabelText("AI 提供商列表上限（条）")).toHaveValue(100);
    expect(screen.getByLabelText("AI 对话列表上限（条）")).toHaveValue(200);
    expect(screen.getByText(/任务中心和 AI 列表上限相关项会立即生效/)).toBeInTheDocument();
  });

  it("surfaces runtime setting sources, active values, apply locations, and restart boundaries", () => {
    render(<SettingsClient settings={{}} canManage runtimeSettings={[{
      key: "runtime.commandReconcileIntervalMs",
      label: "命令维护扫描间隔",
      unit: "毫秒",
      env: "COMMAND_RECONCILE_INTERVAL_MS",
      value: 45000,
      defaultValue: 60000,
      min: 5000,
      max: 3600000,
      source: "environment",
      sourceLabel: "环境变量",
      applies: "需要重启服务后重新安排后台扫描定时器",
      requiresRestart: true,
    }]} />);

    expect(screen.getByText(/当前运行值来自数据库设置、环境变量或系统默认值/)).toBeInTheDocument();
    expect(screen.getByText(/当前运行值：/)).toBeInTheDocument();
    expect(screen.getByText("45000")).toBeInTheDocument();
    expect(screen.getByText(/来源：环境变量/)).toBeInTheDocument();
    expect(screen.getByText(/COMMAND_RECONCILE_INTERVAL_MS/)).toBeInTheDocument();
    expect(screen.getAllByText(/需重启对应服务/).length).toBeGreaterThan(0);
  });

  it("surfaces latest setting update audit metadata per high-risk section", () => {
    render(<SettingsClient settings={{}} canManage settingUpdateMetadata={{
      "runtime.commandExecutionTimeoutMs": {
        updatedAt: new Date("2026-06-02T03:04:05Z"),
        actorId: "u1",
        actorName: "Alice Admin",
      },
      "smtp.enabled": {
        updatedAt: new Date("2026-06-01T03:04:05Z"),
        actorId: "u2",
        actorName: "Ops User",
      },
    }} />);

    expect(screen.getAllByText("最近修改").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText("修改人：Alice Admin")).toBeInTheDocument();
    expect(screen.getByText("修改人：Ops User")).toBeInTheDocument();
    expect(screen.getAllByText("修改人：暂无审计记录").length).toBeGreaterThanOrEqual(1);
  });

  it("keeps Settings light-theme form label overrides in the CSS compatibility layer", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

    expect(css).toContain("html.light .text-[var(--text-primary)]\\/50");
    expect(css).toContain("html.light .text-[var(--text-primary)]\\/40");
  });
  it("makes disabled SMTP fields visually and behaviorally inactive until SMTP is enabled", async () => {
    const user = userEvent.setup();

    render(<SettingsClient settings={{ "smtp.enabled": "false", "smtp.host": "smtp.example.com", "smtp.port": "587" }} canManage />);

    expect(screen.getByText(/SMTP 未启用，连接参数会保留但不会被用于发送邮件/)).toBeInTheDocument();
    const smtpHost = screen.getByLabelText("SMTP 服务器");
    expect(smtpHost).toBeDisabled();
    expect(smtpHost.parentElement).toHaveClass("opacity-70");
    expect(screen.getAllByText("启用 SMTP 后可编辑").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("switch", { name: "启用 SMTP" }));

    expect(screen.getByText("SMTP 已启用，告警规则选择 email 渠道时会发送到下方收件人。")).toBeInTheDocument();
    expect(screen.getByLabelText("SMTP 服务器")).toBeEnabled();
    expect(screen.getByLabelText("告警收件人")).toBeEnabled();
  });

  it("validates runtime number bounds before saving", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockResolvedValueOnce({ success: true });

    render(<SettingsClient settings={{ "runtime.commandExecutionTimeoutMs": "1", "runtime.commandOutputLimitBytes": "262144", "runtime.commandStaleRunningAfterMs": "600000", "runtime.commandExecutionHeartbeatMs": "60000", "runtime.commandReconcileIntervalMs": "60000", "runtime.sftpSyncDirectoryTimeoutMs": "60000", "runtime.sshWsHeartbeatIntervalMs": "25000", "runtime.sshIdleTimeoutSec": "600", "runtime.operationTaskListLimit": "100", "runtime.aiProviderListLimit": "100", "runtime.aiConversationListLimit": "200" }} canManage />);
    await user.click(screen.getAllByRole("button", { name: "保存" })[2]!);

    expect(screen.getByText("命令执行超时 必须在 5000 到 3600000 之间")).toBeInTheDocument();
    expect(csrfFetch).not.toHaveBeenCalled();
  });
	it("hosts account two-factor controls in system settings", () => {
		render(<SettingsClient settings={{}} canManage twoFactorEnabled={false} />);

		expect(screen.getByRole("heading", { name: /账户安全/ })).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: /账户安全/ }).closest("section")).toHaveAttribute("id", "2fa");
		expect(screen.getByRole("heading", { name: /会话与安全/ }).closest("section")).toHaveAttribute("id", "password");
		expect(screen.getByRole("heading", { name: /两步验证 \(2FA\)/ })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "开启两步验证" })).toBeInTheDocument();
	});
});

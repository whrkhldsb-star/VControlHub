import fs from "node:fs";
import path from "node:path";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsClient } from "../settings-client";

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
		await user.click(screen.getAllByRole("button", { name: "保存" })[0]);

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
		await user.click(screen.getAllByRole("button", { name: "保存" })[0]);

		expect(screen.getByText("Logo URL 只支持 http(s) 或站内路径")).toBeInTheDocument();
		expect(csrfFetch).not.toHaveBeenCalled();
	});

	it("shows API errors instead of falsely reporting success", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("权限不足"));

		render(<SettingsClient settings={{ "platform.name": "旧名称", "platform.logo": "" }} canManage />);
		await user.click(screen.getAllByRole("button", { name: "保存" })[0]);

		expect(await screen.findByText("权限不足")).toBeInTheDocument();
		expect(screen.queryByText(/✓ 设置已保存/)).not.toBeInTheDocument();
	});

  it("persists edited runtime settings through the settings API", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockResolvedValueOnce({ success: true });

    render(<SettingsClient settings={{ "runtime.commandExecutionTimeoutMs": "300000", "runtime.commandOutputLimitBytes": "262144", "runtime.commandStaleRunningAfterMs": "600000", "runtime.commandExecutionHeartbeatMs": "60000", "runtime.commandReconcileIntervalMs": "60000", "runtime.sftpSyncDirectoryTimeoutMs": "60000", "runtime.sshWsHeartbeatIntervalMs": "25000", "runtime.sshKeepaliveIntervalMs": "30000", "runtime.sshKeepaliveCountMax": "60", "runtime.operationTaskListLimit": "100", "runtime.aiProviderListLimit": "100", "runtime.aiConversationListLimit": "200" }} canManage />);
    await user.clear(screen.getByLabelText("命令执行超时（毫秒）"));
    await user.type(screen.getByLabelText("命令执行超时（毫秒）"), "120000");
    await user.click(screen.getAllByRole("button", { name: "保存" })[2]);

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
          "runtime.sshKeepaliveIntervalMs": "30000",
          "runtime.sshKeepaliveCountMax": "60",
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
    expect(fieldCard).toHaveClass("light:border-slate-200");
    expect(fieldCard?.querySelector("label")).toHaveClass("light:text-slate-700");
  });

  it("surfaces SSH terminal keepalive runtime settings in the admin Settings UX", () => {
    render(<SettingsClient settings={{}} canManage />);

    expect(screen.getByLabelText("SSH WebSocket 心跳间隔（毫秒，需重启）")).toHaveValue(25000);
    expect(screen.getByLabelText("SSH keepalive 间隔（毫秒，需重启）")).toHaveValue(30000);
    expect(screen.getByLabelText("SSH keepalive 容忍次数（需重启，默认强保活）")).toHaveValue(60);
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

  it("keeps Settings light-theme form label overrides in the CSS compatibility layer", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

    expect(css).toContain("html.light .text-white\\/50");
    expect(css).toContain("html.light .text-white\\/40");
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

    expect(screen.getByText("SMTP 已启用，保存后系统通知会立即使用最新连接参数。")).toBeInTheDocument();
    expect(screen.getByLabelText("SMTP 服务器")).toBeEnabled();
  });

  it("validates runtime number bounds before saving", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockResolvedValueOnce({ success: true });

    render(<SettingsClient settings={{ "runtime.commandExecutionTimeoutMs": "1", "runtime.commandOutputLimitBytes": "262144", "runtime.commandStaleRunningAfterMs": "600000", "runtime.commandExecutionHeartbeatMs": "60000", "runtime.commandReconcileIntervalMs": "60000", "runtime.sftpSyncDirectoryTimeoutMs": "60000", "runtime.sshWsHeartbeatIntervalMs": "25000", "runtime.sshKeepaliveIntervalMs": "30000", "runtime.sshKeepaliveCountMax": "60", "runtime.operationTaskListLimit": "100", "runtime.aiProviderListLimit": "100", "runtime.aiConversationListLimit": "200" }} canManage />);
    await user.click(screen.getAllByRole("button", { name: "保存" })[2]);

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

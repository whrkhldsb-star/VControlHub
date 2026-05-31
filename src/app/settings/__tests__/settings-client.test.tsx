import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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
		expect(await screen.findByText("✓ 设置已保存")).toBeInTheDocument();
	});

	it("shows API errors instead of falsely reporting success", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("权限不足"));

		render(<SettingsClient settings={{ "platform.name": "旧名称", "platform.logo": "" }} canManage />);
		await user.click(screen.getAllByRole("button", { name: "保存" })[0]);

		expect(await screen.findByText("权限不足")).toBeInTheDocument();
		expect(screen.queryByText("✓ 设置已保存")).not.toBeInTheDocument();
	});

  it("persists edited runtime settings through the settings API", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockResolvedValueOnce({ success: true });

    render(<SettingsClient settings={{ "runtime.commandExecutionTimeoutMs": "300000", "runtime.commandOutputLimitBytes": "262144", "runtime.commandStaleRunningAfterMs": "600000", "runtime.commandExecutionHeartbeatMs": "60000", "runtime.commandReconcileIntervalMs": "60000", "runtime.sftpSyncDirectoryTimeoutMs": "60000", "runtime.sshWsHeartbeatIntervalMs": "25000", "runtime.sshKeepaliveIntervalMs": "30000", "runtime.sshKeepaliveCountMax": "8" }} canManage />);
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
          "runtime.sshKeepaliveCountMax": "8",
        }),
      }));
    });
  });

  it("surfaces SSH terminal keepalive runtime settings in the admin Settings UX", () => {
    render(<SettingsClient settings={{}} canManage />);

    expect(screen.getByLabelText("SSH WebSocket 心跳间隔（毫秒，需重启）")).toHaveValue(25000);
    expect(screen.getByLabelText("SSH keepalive 间隔（毫秒，需重启）")).toHaveValue(30000);
    expect(screen.getByLabelText("SSH keepalive 容忍次数（需重启）")).toHaveValue(8);
    expect(screen.getByText(/SSH 终端连接保活参数需要重启对应服务后生效/)).toBeInTheDocument();
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

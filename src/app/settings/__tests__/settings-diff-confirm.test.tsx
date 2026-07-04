/**
 * TR-014 M01b: SaveButtonWithDiff (diff 角标) + HighRiskConfirmModal (二次确认).
 *
 * 重点：
 *  - diff 角标只在有未保存修改时出现, 颜色按最高风险色编码
 *  - 角标点击展开 inline 表格 (字段/原值/新值/风险)
 *  - 保存时, 如果本 section 含 high 风险修改, 弹 <dialog> 二次确认
 *  - confirm 后才真正调 /api/settings; cancel 后回滚
 *  - 仅 low/medium 修改时, save 直接调 API 不弹 modal
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import { SettingsClient } from "@/app/settings/settings-client";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { I18nProvider } from "@/lib/i18n/provider";

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn() }),
}));

const wrap = (ui: React.ReactNode) => render(<I18nProvider initialLocale="zh">{ui}</I18nProvider>);

const baseRuntimeSettings = {
	"platform.name": "VPS 统一管控平台",
	"runtime.commandExecutionTimeoutMs": "300000",
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
};

describe("SaveButtonWithDiff (TR-014 M01b)", () => {
	beforeEach(() => {
		vi.mocked(csrfFetch).mockReset();
	});

	it("hides the pending badge when no fields are modified", () => {
		wrap(<SettingsClient settings={baseRuntimeSettings} canManage />);
		// No field is modified; no "项已修改" badge anywhere
		expect(screen.queryByText(/项已修改/)).toBeNull();
	});

	it("shows a pending badge with count when a field is modified", async () => {
		const user = userEvent.setup();
		wrap(<SettingsClient settings={baseRuntimeSettings} canManage />);
		// commandOutputLimitBytes is medium risk — change it to trigger badge (without opening confirm modal)
		await user.clear(screen.getByLabelText("命令输出保留上限（字节）"));
		await user.type(screen.getByLabelText("命令输出保留上限（字节）"), "100000");
		const badge = await screen.findByText(/1 项已修改/);
		expect(badge).toBeInTheDocument();
		expect(badge.closest("button")).toHaveAttribute("data-pending-count", "1");
	});

	it("expands an inline diff table when the badge is clicked", async () => {
		const user = userEvent.setup();
		wrap(<SettingsClient settings={baseRuntimeSettings} canManage />);
		await user.clear(screen.getByLabelText("命令输出保留上限（字节）"));
		await user.type(screen.getByLabelText("命令输出保留上限（字节）"), "100000");

		const badge = await screen.findByText(/1 项已修改/);
		await user.click(badge);
		const table = await screen.findByRole("region", { name: "Unsaved changes" });
		expect(table).toBeInTheDocument();
		expect(table.querySelector('[data-pending-key="runtime.commandOutputLimitBytes"]')).not.toBeNull();
	});

	it("uses danger tone for high-risk pending changes (badge + save button)", async () => {
		const user = userEvent.setup();
		wrap(<SettingsClient settings={baseRuntimeSettings} canManage />);
		// commandExecutionTimeoutMs is high risk
		await user.clear(screen.getByLabelText("命令执行超时（毫秒）"));
		await user.type(screen.getByLabelText("命令执行超时（毫秒）"), "120000");
		const badge = await screen.findByText(/1 项已修改 · 1 高风险/);
		expect(badge.closest("button")?.className).toContain("var(--danger)");
	});
});

describe("HighRiskConfirmModal (TR-014 M01b)", () => {
	beforeEach(() => {
		vi.mocked(csrfFetch).mockReset();
	});

	it("opens the modal when saving with a high-risk change", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockResolvedValueOnce({ success: true });
		wrap(<SettingsClient settings={baseRuntimeSettings} canManage />);

		await user.clear(screen.getByLabelText("命令执行超时（毫秒）"));
		await user.type(screen.getByLabelText("命令执行超时（毫秒）"), "120000");
		// The runtime section's Save button: scope to the runtime <section> so we don't grab the platform one
		const runtimeSection = screen.getByRole("heading", { name: /运行参数/ }).closest("section")!;
		const saveBtn = within(runtimeSection).getByRole("button", { name: "保存" });
		await user.click(saveBtn);

		// The dialog should now be open with high-risk content
		const dialog = await screen.findByTestId("high-risk-confirm-modal");
		expect(dialog).toBeInTheDocument();
		expect(within(dialog).getByText(/命令执行超时/)).toBeInTheDocument();
		// API not yet called
		expect(csrfFetch).not.toHaveBeenCalled();
	});

	it("does NOT call the API when cancel is clicked", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockResolvedValueOnce({ success: true });
		wrap(<SettingsClient settings={baseRuntimeSettings} canManage />);

		await user.clear(screen.getByLabelText("命令执行超时（毫秒）"));
		await user.type(screen.getByLabelText("命令执行超时（毫秒）"), "120000");
		const runtimeSection = screen.getByRole("heading", { name: /运行参数/ }).closest("section")!;
		await user.click(within(runtimeSection).getByRole("button", { name: "保存" }));
		await screen.findByTestId("high-risk-confirm-modal");

		await user.click(screen.getByRole("button", { name: "取消" }));
		await waitFor(() => {
			expect(csrfFetch).not.toHaveBeenCalled();
		});
	});

	it("calls the API only after 确认保存 is clicked", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockResolvedValueOnce({ success: true });
		wrap(<SettingsClient settings={baseRuntimeSettings} canManage />);

		await user.clear(screen.getByLabelText("命令执行超时（毫秒）"));
		await user.type(screen.getByLabelText("命令执行超时（毫秒）"), "120000");
		const runtimeSection = screen.getByRole("heading", { name: /运行参数/ }).closest("section")!;
		await user.click(within(runtimeSection).getByRole("button", { name: "保存" }));
		await screen.findByTestId("high-risk-confirm-modal");

		await user.click(screen.getByRole("button", { name: "确认保存" }));

		await waitFor(() => {
			expect(csrfFetch).toHaveBeenCalledWith(
				"/api/settings",
				expect.objectContaining({
					method: "PATCH",
					body: expect.stringContaining('"runtime.commandExecutionTimeoutMs":"120000"'),
				}),
			);
		});
	});

	it("does NOT open the modal when only medium/low fields are modified", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockResolvedValueOnce({ success: true });
		wrap(<SettingsClient settings={baseRuntimeSettings} canManage />);

		// commandOutputLimitBytes is medium — change only this, no high
		await user.clear(screen.getByLabelText("命令输出保留上限（字节）"));
		await user.type(screen.getByLabelText("命令输出保留上限（字节）"), "100000");
		const runtimeSection = screen.getByRole("heading", { name: /运行参数/ }).closest("section")!;
		await user.click(within(runtimeSection).getByRole("button", { name: "保存" }));

		// Modal must NOT appear; API should be called directly
		expect(screen.queryByTestId("high-risk-confirm-modal")).toBeNull();
		await waitFor(() => {
			expect(csrfFetch).toHaveBeenCalledTimes(1);
		});
	});
});

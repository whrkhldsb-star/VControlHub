import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/toast-provider";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { api } from "@/lib/http/api-client";
import { CommandLaunchForm } from "../command-launch-form";

const routerMocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
	useRouter: () => routerMocks,
}));

vi.mock("@/lib/http/api-client", () => ({
	api: { post: vi.fn() },
}));

const servers = [
	{ id: "srv_1", name: "香港生产节点", host: "203.0.113.10" },
	{ id: "srv_2", name: "东京生产节点", host: "203.0.113.11" },
];

describe("CommandLaunchForm", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("submits a direct command with explicit targets and redirects to run history", async () => {
		const actor = userEvent.setup();
		vi.mocked(api.post).mockResolvedValue({ command: { id: "cmd_1", status: "APPROVED" } });
		renderWithI18n(
			<ToastProvider>
				<CommandLaunchForm servers={servers} allowDirectExecution />
			</ToastProvider>,
		);

		await actor.click(screen.getByRole("button", { name: "立即执行" }));
		const submit = screen.getByRole("button", { name: "确认并立即执行" });
		expect(submit).toBeDisabled();
		await actor.type(screen.getByLabelText("任务名称"), "重启 nginx");
		await actor.type(screen.getByLabelText("命令内容"), "sudo systemctl restart nginx");
		await actor.type(screen.getByLabelText("执行原因"), "发布后重载");
		await actor.click(screen.getByText("香港生产节点"));
		await actor.click(submit);
		expect(api.post).not.toHaveBeenCalled();
		const dialog = screen.getByRole("dialog", { name: "确认立即执行命令" });
		expect(dialog).toHaveTextContent("sudo systemctl restart nginx");
		expect(dialog).toHaveTextContent("香港生产节点");
		expect(dialog).toHaveTextContent("发布后重载");
		await actor.click(screen.getByRole("button", { name: "确认执行" }));

		await waitFor(() => expect(api.post).toHaveBeenCalledWith(
			"/api/commands",
			expect.objectContaining({
				title: "重启 nginx",
				command: "sudo systemctl restart nginx",
				reason: "发布后重载",
				serverIds: ["srv_1"],
				submissionMode: "user",
				approvalRequired: false,
				idempotencyKey: expect.stringMatching(/^command-ui:/),
			}),
		));
		expect(await screen.findByText("命令已提交到执行队列。")).toBeInTheDocument();
		expect(routerMocks.push).toHaveBeenCalledWith("/requests");
		expect(routerMocks.refresh).toHaveBeenCalled();
	});

	it("shows unhealthy nodes but prevents selecting them", async () => {
		renderWithI18n(
			<ToastProvider>
				<CommandLaunchForm
					servers={[...servers, { id: "srv_bad", name: "故障节点", host: "203.0.113.12", available: false, unavailableReason: "最近健康检查失败" }]}
					allowDirectExecution
				/>
			</ToastProvider>,
		);

		const unavailable = screen.getByRole("checkbox", { name: /故障节点/ });
		expect(unavailable).toBeDisabled();
		expect(screen.getByText("最近健康检查失败")).toBeVisible();
	});

	it("supports selecting and clearing every enabled target", async () => {
		const actor = userEvent.setup();
		renderWithI18n(
			<ToastProvider>
				<CommandLaunchForm servers={servers} allowDirectExecution />
			</ToastProvider>,
		);

		await actor.click(screen.getByRole("button", { name: "选择全部启用节点" }));
		expect(screen.getByText(/已选择 2 台/)).toBeInTheDocument();
		expect(screen.getAllByRole("checkbox")).toHaveLength(2);
		expect(screen.getAllByRole("checkbox").every((input) => (input as HTMLInputElement).checked)).toBe(true);

		await actor.click(screen.getByRole("button", { name: "取消全选" }));
		expect(screen.getByText("请至少选择一台目标节点。")).toBeInTheDocument();
	});

	it("defaults to approval and does not expose direct execution without permission", async () => {
		const actor = userEvent.setup();
		vi.mocked(api.post).mockResolvedValue({ command: { id: "cmd_2", status: "PENDING_APPROVAL", requiresApproval: true } });
		renderWithI18n(
			<ToastProvider>
				<CommandLaunchForm servers={servers} allowDirectExecution={false} />
			</ToastProvider>,
		);

		expect(screen.queryByRole("button", { name: "立即执行" })).not.toBeInTheDocument();
		await actor.type(screen.getByLabelText("任务名称"), "检查磁盘");
		await actor.type(screen.getByLabelText("命令内容"), "df -h");
		await actor.click(screen.getByText("东京生产节点"));
		await actor.click(screen.getByRole("button", { name: "提交审批" }));

		await waitFor(() => expect(api.post).toHaveBeenCalledWith(
			"/api/commands",
			expect.objectContaining({ approvalRequired: true, submissionMode: "user", serverIds: ["srv_2"] }),
		));
		expect(await screen.findByText("命令请求已提交，等待审批。")).toBeInTheDocument();
	});

	it("reuses the idempotency key when an unchanged submission is retried", async () => {
		const actor = userEvent.setup();
		vi.mocked(api.post)
			.mockRejectedValueOnce(new Error("connection lost"))
			.mockResolvedValueOnce({ command: { id: "cmd_retry", status: "PENDING_APPROVAL" } });
		renderWithI18n(
			<ToastProvider>
				<CommandLaunchForm servers={servers} allowDirectExecution={false} />
			</ToastProvider>,
		);

		await actor.type(screen.getByLabelText("任务名称"), "检查磁盘");
		await actor.type(screen.getByLabelText("命令内容"), "df -h");
		await actor.click(screen.getByText("香港生产节点"));
		const submit = screen.getByRole("button", { name: "提交审批" });
		await actor.click(submit);
		expect(await screen.findByText("connection lost")).toBeInTheDocument();
		await actor.click(submit);

		await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
		const firstPayload = vi.mocked(api.post).mock.calls[0]?.[1] as { idempotencyKey: string };
		const secondPayload = vi.mocked(api.post).mock.calls[1]?.[1] as { idempotencyKey: string };
		expect(secondPayload.idempotencyKey).toBe(firstPayload.idempotencyKey);
	});

	it("keeps the confirmation open with the refusal in it when a direct command is not accepted", async () => {
		// The dialog closed before the request was sent; the reason then appeared near the top of a long form,
		// with the button the user had pressed at the bottom of it.
		const actor = userEvent.setup();
		vi.mocked(api.post)
			.mockRejectedValueOnce(new Error("命令包含被策略禁止的内容"))
			.mockResolvedValueOnce({ command: { id: "cmd_2", status: "APPROVED" } });
		renderWithI18n(
			<ToastProvider>
				<CommandLaunchForm servers={servers} allowDirectExecution />
			</ToastProvider>,
		);
		await actor.click(screen.getByRole("button", { name: "立即执行" }));
		await actor.type(screen.getByLabelText("任务名称"), "清理缓存");
		await actor.type(screen.getByLabelText("命令内容"), "sync");
		await actor.click(screen.getByText("香港生产节点"));
		await actor.click(screen.getByRole("button", { name: "确认并立即执行" }));
		const dialog = screen.getByRole("dialog", { name: "确认立即执行命令" });
		await actor.click(within(dialog).getByRole("button", { name: "确认执行" }));

		expect(await within(dialog).findByRole("alert")).toHaveTextContent("命令包含被策略禁止的内容");
		expect(screen.getByRole("dialog", { name: "确认立即执行命令" })).toBeInTheDocument();
		expect(routerMocks.push).not.toHaveBeenCalled();

		// Tried again from the dialog.
		await actor.click(within(dialog).getByRole("button", { name: "确认执行" }));
		await waitFor(() => expect(routerMocks.push).toHaveBeenCalledWith("/requests"));
	});

	it("shows a refused approval request next to the button that sent it", async () => {
		const actor = userEvent.setup();
		vi.mocked(api.post).mockRejectedValueOnce(new Error("目标服务器已被停用"));
		renderWithI18n(
			<ToastProvider>
				<CommandLaunchForm servers={servers} allowDirectExecution={false} />
			</ToastProvider>,
		);
		await actor.type(screen.getByLabelText("任务名称"), "检查磁盘");
		await actor.type(screen.getByLabelText("命令内容"), "df -h");
		await actor.click(screen.getByText("香港生产节点"));
		const submit = screen.getByRole("button", { name: "提交审批" });
		await actor.click(submit);
		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("目标服务器已被停用");
		// After the fields, right above the row with the button.
		expect(screen.getByLabelText("命令内容").compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(alert.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});

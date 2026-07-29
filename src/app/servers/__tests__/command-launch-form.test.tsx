import { screen, waitFor } from "@testing-library/react";
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
});

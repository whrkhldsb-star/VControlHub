import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { PlaybookListClient } from "../playbook-list-client";
import { reorderSteps } from "../playbook-types";

const addToastMock = vi.fn();

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/toast-provider", () => ({
	useToast: () => ({ addToast: addToastMock }),
	ToastProvider: ({ children }: { children: ReactNode }) => children,
}));

const stepA = { id: "a", name: "第一步", type: "run_command" as const, config: { command: "echo first", serverIds: ["srv1"] }, retry: 0, timeoutSec: 60 };
const stepB = { id: "b", name: "第二步", type: "run_command" as const, config: { command: "echo second", serverIds: ["srv1"] }, retry: 0, timeoutSec: 60 };
const stepC = { id: "c", name: "第三步", type: "run_command" as const, config: { command: "echo third", serverIds: ["srv1"] }, retry: 0, timeoutSec: 60 };

const playbook = {
	id: "pb_1",
	name: "夜间维护",
	description: null,
	triggerType: "cron" as const,
	triggerConfig: { expression: "0 3 * * *" },
	steps: [stepA, stepB],
	chainRetry: 0,
	enabled: true,
	nextRunAt: "2026-01-02T03:00:00.000Z",
	lastTriggeredAt: null,
		ownerActive: true,
	createdAt: "2026-01-01T00:00:00.000Z",
};

const testServers = [
	{ id: "srv1", name: "主节点", host: "10.0.0.1", enabled: true },
	{ id: "srv2", name: "备节点", host: "10.0.0.2", enabled: true },
];

function renderClient() {
	return renderWithI18n(
		<PlaybookListClient playbooks={[]} runsByPlaybook={{}} servers={testServers} canManage canRun />,
		{ locale: "zh" },
	);
}

describe("Playbook step ordering", () => {
	it("reorders steps by active and target ids without mutating step payloads", () => {
		const reordered = reorderSteps([stepA, stepB, stepC], "c", "a");
		expect(reordered.map((step) => step.name)).toEqual(["第三步", "第一步", "第二步"]);
		expect(reordered[0]).toBe(stepC);
	});

	it("keeps the current order when the drag target is missing or unchanged", () => {
		const steps = [stepA, stepB, stepC];
		expect(reorderSteps(steps, "c", "missing")).toBe(steps);
		expect(reorderSteps(steps, "b", "b")).toBe(steps);
	});
});

describe("PlaybookListClient run feedback", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows real dry-run step counts instead of hard-coded 0/0", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockResolvedValueOnce({
			run: {
				id: "run_1",
				status: "completed",
				dryRun: true,
				startedAt: "2026-01-01T00:00:00.000Z",
				completedAt: "2026-01-01T00:00:01.000Z",
				errorMessage: null,
				stepResults: [
					{ stepId: "a", status: "dry_run", summary: "dry-run: echo first" },
					{ stepId: "b", status: "dry_run", summary: "dry-run: echo second" },
				],
			},
		});

		renderWithI18n(<PlaybookListClient playbooks={[playbook]} runsByPlaybook={{ pb_1: [] }} servers={testServers} canManage canRun />, { locale: "zh" });

		await user.click(screen.getByRole("button", { name: /Dry-run 演练/ }));

		await waitFor(() => expect(addToastMock).toHaveBeenCalledWith("success", "Dry-run 完成（2/2 步规划成功）"));
		expect(csrfFetch).toHaveBeenCalledWith("/api/playbooks/pb_1/dry-run", { method: "POST" });
	});
	it("surfaces failed dry-run status as an error toast instead of success", async () => {
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockResolvedValueOnce({
			run: {
				id: "run_fail",
				status: "failed",
				dryRun: true,
				startedAt: "2026-01-01T00:00:00.000Z",
				completedAt: "2026-01-01T00:00:01.000Z",
				errorMessage: "boom",
				stepResults: [
					{ stepId: "a", status: "failed", summary: "step failed" },
				],
			},
		});

		renderWithI18n(<PlaybookListClient playbooks={[playbook]} runsByPlaybook={{ pb_1: [] }} servers={testServers} canManage canRun />, { locale: "zh" });

		await user.click(screen.getByRole("button", { name: /Dry-run 演练/ }));

		await waitFor(() =>
			expect(addToastMock).toHaveBeenCalledWith(
				"error",
				expect.stringMatching(/失败|failed/i),
			),
		);
		expect(addToastMock).not.toHaveBeenCalledWith("success", expect.anything());
	});

});

describe("Playbook actions that fail", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const renderOne = () =>
		renderWithI18n(<PlaybookListClient playbooks={[playbook]} runsByPlaybook={{ pb_1: [] }} servers={testServers} canManage canRun />, { locale: "zh" });

	it("shows a refused deletion in the confirmation dialog, which stays open", async () => {
		// It went to the notice at the top of the page, behind the dialog.
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("Playbook 正在运行，无法删除"));
		renderOne();
		await user.click(screen.getByRole("button", { name: "删除" }));
		const dialog = screen.getByRole("dialog");
		await user.click(within(dialog).getByRole("button", { name: "确认删除" }));
		expect(await within(dialog).findByText("Playbook 正在运行，无法删除")).toBeInTheDocument();
		// Opened again, it starts clean.
		await user.click(within(dialog).getByRole("button", { name: "取消" }));
		await user.click(screen.getByRole("button", { name: "删除" }));
		expect(within(screen.getByRole("dialog")).queryByText("Playbook 正在运行，无法删除")).not.toBeInTheDocument();
	});

	it("names the switch by what it will do, and the result by what it did", async () => {
		// One button read "启用 / 停用" in both states, and the toast "启用状态已切换".
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockResolvedValue({ playbooks: [{ ...playbook, enabled: false }], runsByPlaybook: {} });
		renderOne();
		expect(screen.queryByRole("button", { name: "启用" })).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "停用" }));
		expect(vi.mocked(csrfFetch).mock.calls[0]?.[1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ id: "pb_1", enabled: false }) });
		await waitFor(() => expect(addToastMock).toHaveBeenCalledWith("success", "已停用「夜间维护」"));
		vi.mocked(csrfFetch).mockReset();
	});

	it("names the run that could not start, where the click was", async () => {
		// The fallback read "加载 Playbook 列表失败", in a notice at the top of a list that can be pages long.
		const user = userEvent.setup();
		vi.mocked(csrfFetch).mockRejectedValueOnce({ status: 500 });
		renderOne();
		await user.click(screen.getByRole("button", { name: "立即运行" }));
		await waitFor(() => expect(addToastMock).toHaveBeenCalledWith("error", "运行 Playbook 失败"));

		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("目标服务器已停用"));
		await user.click(screen.getByRole("button", { name: /Dry-run 演练/ }));
		await waitFor(() => expect(addToastMock).toHaveBeenCalledWith("error", "目标服务器已停用"));
	});
});

describe("PlaybookListClient sortable steps", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(csrfFetch).mockResolvedValue({ playbook: { id: "pb_1", steps: [] } });
	});

	it("renders accessible drag handles and submits the current step order", async () => {
		const user = userEvent.setup();
		renderClient();

		await user.click(screen.getAllByRole("button", { name: /新建 Playbook/ })[0]!);
		await user.type(screen.getByLabelText("Playbook 名称"), "夜间维护");

		const addStepButton = screen.getByRole("button", { name: /添加步骤/ });
		await user.click(addStepButton);
		await user.click(addStepButton);

		expect(screen.getByRole("button", { name: "拖拽排序第 1 个步骤" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "拖拽排序第 2 个步骤" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "拖拽排序第 3 个步骤" })).toBeInTheDocument();

		const stepNameInputs = screen.getAllByLabelText("步骤名称");
		await user.type(stepNameInputs[0]!, "第一步");
		await user.type(stepNameInputs[1]!, "第二步");
		await user.type(stepNameInputs[2]!, "第三步");

		const commandBoxes = screen.getAllByPlaceholderText("docker compose up -d");
		await user.type(commandBoxes[0]!, "echo first");
		await user.type(commandBoxes[1]!, "echo second");
		await user.type(commandBoxes[2]!, "echo third");

		// Select at least one target VPS per run_command step (required by schema).
		const checkboxes = screen.getAllByRole("checkbox");
		// 3 steps × 2 servers = 6 checkboxes; pick first server on each step (indices 0,2,4)
		await user.click(checkboxes[0]!);
		await user.click(checkboxes[2]!);
		await user.click(checkboxes[4]!);

		await user.click(screen.getByRole("button", { name: "保存 Playbook" }));

		await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/playbooks", expect.objectContaining({ method: "POST" })));
		const [, options] = vi.mocked(csrfFetch).mock.calls.find(([url]) => url === "/api/playbooks")!;
		const body = JSON.parse(String(options?.body));
		expect(body.steps.map((step: { name: string }) => step.name)).toEqual(["第一步", "第二步", "第三步"]);
		for (const step of body.steps) {
			expect(step.config.serverIds).toEqual(["srv1"]);
		}
		expect(addToastMock).toHaveBeenCalledWith("success", "Playbook 已创建");
	});
});

describe("PlaybookListClient editing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(csrfFetch).mockResolvedValue({ playbook: { id: "pb_1", steps: [] }, playbooks: [] });
	});

	// The page offered run, switch, claim and delete: changing one command meant deleting the playbook and
	// building it again. The form opens with the playbook's own values and saves them as a PATCH.
	it("opens a playbook in the form with its values and saves the changes to it", async () => {
		const user = userEvent.setup();
		renderWithI18n(
			<PlaybookListClient playbooks={[playbook]} runsByPlaybook={{}} servers={testServers} canManage canRun />,
			{ locale: "zh" },
		);

		await user.click(screen.getByRole("button", { name: "编辑" }));
		expect(screen.getByRole("heading", { name: "编辑 Playbook：夜间维护" })).toBeInTheDocument();
		expect(screen.getByLabelText("Playbook 名称")).toHaveValue("夜间维护");
		expect(screen.getAllByLabelText("步骤名称").map((input) => (input as HTMLInputElement).value)).toEqual(["第一步", "第二步"]);
		expect(screen.getByLabelText("Cron 表达式（5 字段）")).toHaveValue("0 3 * * *");
		// One form at a time: the list's edit buttons wait for it.
		expect(screen.getByRole("button", { name: "编辑" })).toBeDisabled();

		const name = screen.getByLabelText("Playbook 名称");
		await user.clear(name);
		await user.type(name, "夜间维护（新）");
		await user.click(screen.getByRole("button", { name: "保存修改" }));

		await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/playbooks/pb_1", expect.objectContaining({ method: "PATCH" })));
		const [, options] = vi.mocked(csrfFetch).mock.calls.find(([url]) => url === "/api/playbooks/pb_1")!;
		// Only the name changed, so only the name is sent: a re-sent trigger takes playbook:run.
		expect(JSON.parse(String(options?.body))).toEqual({ id: "pb_1", name: "夜间维护（新）" });
		expect(addToastMock).toHaveBeenCalledWith("success", "已保存对“夜间维护（新）”的修改");
		await waitFor(() => expect(screen.queryByRole("button", { name: "保存修改" })).not.toBeInTheDocument());
	});

	// Changing when a saved playbook runs takes playbook:run: the server refused it after the fact.
	it("keeps the trigger, switch and retries of a saved playbook fixed without the run permission", async () => {
		const user = userEvent.setup();
		renderWithI18n(
			<PlaybookListClient playbooks={[playbook]} runsByPlaybook={{}} servers={testServers} canManage canRun={false} />,
			{ locale: "zh" },
		);

		await user.click(screen.getByRole("button", { name: "编辑" }));
		expect(screen.getByLabelText("Cron 表达式（5 字段）")).toBeDisabled();
		expect(screen.getByRole("radio", { name: "指标触发器" })).toBeDisabled();
		expect(screen.getByLabelText("启用")).toBeDisabled();
		expect(screen.getByText("触发方式、启用状态和重试次数需要 Playbook 运行权限才能修改")).toBeInTheDocument();
		// What it may change stays open.
		expect(screen.getByLabelText("Playbook 名称")).toBeEnabled();
	});
});

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";
import { PlaybookListClient } from "../playbook-list-client";
import { reorderSteps } from "../playbook-types";

const addToastMock = vi.fn();

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));

vi.mock("@/components/toast-provider", () => ({
	useToast: () => ({ addToast: addToastMock }),
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

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

const stepA = { id: "a", name: "第一步", type: "run_command" as const, config: { command: "echo first", serverIds: [] }, retry: 0, timeoutSec: 60 };
const stepB = { id: "b", name: "第二步", type: "run_command" as const, config: { command: "echo second", serverIds: [] }, retry: 0, timeoutSec: 60 };
const stepC = { id: "c", name: "第三步", type: "run_command" as const, config: { command: "echo third", serverIds: [] }, retry: 0, timeoutSec: 60 };

function renderClient() {
	return renderWithI18n(
		<PlaybookListClient playbooks={[]} runsByPlaybook={{}} canManage canRun />,
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

		await user.click(screen.getByRole("button", { name: "保存 Playbook" }));

		await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/playbooks", expect.objectContaining({ method: "POST" })));
		const [, options] = vi.mocked(csrfFetch).mock.calls.find(([url]) => url === "/api/playbooks")!;
		const body = JSON.parse(String(options?.body));
		expect(body.steps.map((step: { name: string }) => step.name)).toEqual(["第一步", "第二步", "第三步"]);
		expect(addToastMock).toHaveBeenCalledWith("success", "Playbook 已创建");
	});
});

import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";

const action = vi.hoisted(() => ({ batchToggleServerAction: vi.fn() }));
vi.mock("../actions", () => action);

import { BatchServerActionPanel } from "../batch-server-action-panel";

const servers = [
	{ id: "srv_1", name: "香港生产节点", enabled: true },
	{ id: "srv_2", name: "东京生产节点", enabled: true },
];

async function disable(name: string) {
	fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(name) }));
	fireEvent.click(screen.getByRole("button", { name: "停用节点" }));
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "确认停用 1 台节点" }));
	});
	await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("BatchServerActionPanel", () => {
	beforeEach(() => {
		action.batchToggleServerAction.mockReset();
	});

	it("asks before disabling, with the way back where the first press was", () => {
		// The second step was the same words on a button in the same place: a double click went through both.
		renderWithI18n(<BatchServerActionPanel servers={servers} enabledCount={2} />);
		fireEvent.click(screen.getByRole("checkbox", { name: /香港生产节点/ }));
		fireEvent.click(screen.getByRole("checkbox", { name: /东京生产节点/ }));
		fireEvent.click(screen.getByRole("button", { name: "停用节点" }));

		const confirm = screen.getByRole("button", { name: "确认停用 2 台节点" });
		const cancel = screen.getByRole("button", { name: "取消" });
		expect(cancel.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(screen.queryByRole("button", { name: "停用节点" })).not.toBeInTheDocument();

		fireEvent.click(cancel);
		expect(screen.getByRole("button", { name: "停用节点" })).toBeInTheDocument();
		expect(screen.getByRole("checkbox", { name: /香港生产节点/ })).toBeChecked();
		expect(action.batchToggleServerAction).not.toHaveBeenCalled();
	});

	it("clears the selection after every batch, also when two batches end with the same sentence", async () => {
		// A new object for each call, as an action's answer is.
		action.batchToggleServerAction.mockImplementation(async () => ({ success: "已停用 1 台节点" }));
		renderWithI18n(<BatchServerActionPanel servers={servers} enabledCount={2} />);

		await disable("香港生产节点");
		expect(screen.getByRole("checkbox", { name: /香港生产节点/ })).not.toBeChecked();

		await disable("东京生产节点");
		expect(action.batchToggleServerAction).toHaveBeenCalledTimes(2);
		expect(screen.getByRole("checkbox", { name: /东京生产节点/ })).not.toBeChecked();
		expect(screen.getByRole("button", { name: "停用节点" })).toBeDisabled();
	});
});

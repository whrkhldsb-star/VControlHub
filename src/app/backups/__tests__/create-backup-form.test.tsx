import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";

const action = vi.hoisted(() => ({ createBackupAction: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("../actions", () => action);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { CreateBackupForm } from "../create-backup-form";

async function submit() {
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "创建并执行" }));
	});
	await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("CreateBackupForm", () => {
	beforeEach(() => {
		action.createBackupAction.mockReset();
		refresh.mockReset();
	});

	it("keeps the chosen type and the note when the backup could not start", async () => {
		// React clears the fields of a form whose action has answered, a refusal included: the type went back
		// to "database", and pressing the button again started a backup of another kind than the one chosen.
		action.createBackupAction.mockImplementation(async () => ({ success: false, error: "已有备份正在执行，请稍后再试" }));
		renderWithI18n(<CreateBackupForm />);
		fireEvent.change(screen.getByLabelText("备份类型"), { target: { value: "FULL" } });
		fireEvent.change(screen.getByLabelText("备份备注"), { target: { value: "升级前" } });
		await submit();

		expect(await screen.findByText("已有备份正在执行，请稍后再试")).toBeInTheDocument();
		expect(screen.getByLabelText("备份类型")).toHaveValue("FULL");
		expect(screen.getByLabelText("备份备注")).toHaveValue("升级前");

		await submit();
		const second = action.createBackupAction.mock.calls[1]?.[1] as FormData;
		expect(second.get("type")).toBe("FULL");
		expect(second.get("note")).toBe("升级前");
	});

	it("starts over after a backup was created", async () => {
		action.createBackupAction.mockImplementation(async () => ({ success: true }));
		renderWithI18n(<CreateBackupForm />);
		fireEvent.change(screen.getByLabelText("备份类型"), { target: { value: "FULL" } });
		fireEvent.change(screen.getByLabelText("备份备注"), { target: { value: "升级前" } });
		await submit();
		expect(refresh).toHaveBeenCalled();
		expect(screen.getByLabelText("备份类型")).toHaveValue("DATABASE");
		expect(screen.getByLabelText("备份备注")).toHaveValue("");
	});
});

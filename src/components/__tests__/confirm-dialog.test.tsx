import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "../confirm-dialog";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

describe("ConfirmDialog", () => {
	it("provides a named modal and handles confirm and backdrop cancellation", async () => {
		const user = userEvent.setup();
		const onCancel = vi.fn();
		const onConfirm = vi.fn();
		render(<ConfirmDialog open title="删除项目" description="此操作不可撤销" cancelLabel="取消" confirmLabel="删除" onCancel={onCancel} onConfirm={onConfirm} />);

		const dialog = screen.getByRole("dialog", { name: "删除项目" });
		expect(dialog).toHaveAttribute("aria-modal", "true");
		await user.click(screen.getByRole("button", { name: "删除" }));
		expect(onConfirm).toHaveBeenCalledOnce();

		await user.click(dialog.parentElement!);
		expect(onCancel).toHaveBeenCalledOnce();
	});

	it("does not close from the backdrop when that behavior is disabled", async () => {
		const user = userEvent.setup();
		const onCancel = vi.fn();
		render(<ConfirmDialog open title="确认" description="继续吗" cancelLabel="取消" confirmLabel="继续" onCancel={onCancel} onConfirm={vi.fn()} closeOnBackdrop={false} />);
		await user.click(screen.getByRole("dialog").parentElement!);
		expect(onCancel).not.toHaveBeenCalled();
	});
});

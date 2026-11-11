import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";

const action = vi.hoisted(() => ({ reviewCommandAction: vi.fn() }));
vi.mock("../actions", () => action);

import { ReviewCommandForm } from "../review-command-form";

describe("ReviewCommandForm", () => {
	it("keeps the comment when the decision was not taken", async () => {
		// React clears the fields of a form whose action has answered, a refusal included.
		action.reviewCommandAction.mockImplementation(async () => ({ error: "不能审批自己提交的请求" }));
		renderWithI18n(<ReviewCommandForm commandRequestId="cmd_1" />);
		const comment = screen.getByLabelText("审批意见");
		fireEvent.change(comment, { target: { value: "窗口期外，先不执行" } });
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "拒绝请求" }));
		});
		await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

		expect(await screen.findByText("不能审批自己提交的请求")).toBeInTheDocument();
		expect(comment).toHaveValue("窗口期外，先不执行");
	});
});

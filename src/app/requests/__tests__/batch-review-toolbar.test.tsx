import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n } from "@/lib/i18n/__tests__/test-helpers";

const action = vi.hoisted(() => ({ batchReviewCommandAction: vi.fn() }));
vi.mock("../actions", () => action);

import { BatchReviewToolbar, BatchSelectCheckbox } from "../batch-review-toolbar";

function renderToolbar() {
	return renderWithI18n(
		<BatchReviewToolbar pendingIds={["c1", "c2"]}>
			<div><BatchSelectCheckbox id="c1" />重启 nginx</div>
			<div><BatchSelectCheckbox id="c2" />清理日志</div>
		</BatchReviewToolbar>,
	);
}

async function approveAll(comment: string) {
	fireEvent.click(screen.getByRole("checkbox", { name: "全选待审批请求" }));
	fireEvent.change(screen.getByLabelText("批量审批备注"), { target: { value: comment } });
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: /^批量批准/ }));
	});
}

describe("BatchReviewToolbar", () => {
	beforeEach(() => {
		action.batchReviewCommandAction.mockReset();
	});

	it("says why the requests that were not reviewed were refused", async () => {
		// The action answers with a reason for each request; only "1 succeeded, 1 failed" was shown.
		action.batchReviewCommandAction.mockResolvedValue({
			success: "已批准 1 条，1 条失败",
			results: { c1: "ok", c2: "该申请已被其他审批人处理" },
		});
		renderToolbar();
		await approveAll("窗口期内");
		expect(await screen.findByText("已批准 1 条，1 条失败")).toBeInTheDocument();
		expect(screen.getByText("该申请已被其他审批人处理")).toBeInTheDocument();
	});

	it("clears the comment after every reviewed batch, also when two batches end with the same sentence", async () => {
		// A new object for each call, as an action's answer is: it is read from the response every time.
		action.batchReviewCommandAction.mockImplementation(async () => ({ success: "已批准 2 条", results: { c1: "ok", c2: "ok" } }));
		renderToolbar();
		await approveAll("第一批");
		await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
		await approveAll("第二批");
		await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
		fireEvent.click(screen.getByRole("checkbox", { name: "全选待审批请求" }));
		expect(screen.getByLabelText("批量审批备注")).toHaveValue("");
	});
});

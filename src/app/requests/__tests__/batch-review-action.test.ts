/**
 * Tests for batchReviewCommandAction.
 *
 * The action is a thin orchestrator over reviewCommandRequest — these
 * tests focus on its own logic: id dedup, per-id try/catch, aggregate
 * summary, and the empty-selection guard. The underlying service is
 * mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/authorization", () => ({
	requirePermission: vi.fn(async () => ({
		userId: "approver_1",
		roles: ["admin"],
		currentTeamId: null,
	})),
}));

const reviewCommandRequest = vi.fn();
vi.mock("@/lib/command/service", () => ({
	reviewCommandRequest: (...args: unknown[]) => reviewCommandRequest(...args),
}));

vi.mock("next/cache", () => ({
	revalidatePath: vi.fn(),
}));

import { batchReviewCommandAction, reviewCommandAction } from "../actions";

function buildFormData(ids: string[], decision = "approve", comment = "") {
	const fd = new FormData();
	fd.set("decision", decision);
	fd.set("comment", comment);
	for (const id of ids) fd.append("commandRequestId", id);
	return fd;
}

describe("batchReviewCommandAction", () => {
	beforeEach(() => {
		reviewCommandRequest.mockReset();
		reviewCommandRequest.mockResolvedValue(undefined);
	});
	afterEach(() => vi.clearAllMocks());

	it("rejects empty selection with a helpful error", async () => {
		const result = await batchReviewCommandAction(null, buildFormData([]));
		expect(result.error).toBe("未选中任何待审批请求");
		expect(reviewCommandRequest).not.toHaveBeenCalled();
	});

	it("does nothing without an explicit decision: an absent one used to count as approval", async () => {
		const noDecision = new FormData();
		noDecision.append("commandRequestId", "req_1");
		const result = await batchReviewCommandAction(null, noDecision);
		expect(result.error).toBe("没有收到审批决定（批准或拒绝），未做任何操作");
		expect(reviewCommandRequest).not.toHaveBeenCalled();

		const single = await reviewCommandAction(null, noDecision);
		expect(single.error).toContain("没有收到审批决定");
		expect(reviewCommandRequest).not.toHaveBeenCalled();
		expect((await batchReviewCommandAction(null, buildFormData(["req_1"], "maybe"))).error).toContain("没有收到审批决定");
	});

	it("approves all selected requests and returns aggregate success", async () => {
		const result = await batchReviewCommandAction(
			null,
			buildFormData(["req_1", "req_2", "req_3"], "approve", "批量通过"),
		);
		expect(reviewCommandRequest).toHaveBeenCalledTimes(3);
		expect(reviewCommandRequest).toHaveBeenCalledWith(
			{
				commandRequestId: "req_1",
				approverId: "approver_1",
				approved: true,
				comment: "批量通过",
			},
			expect.objectContaining({ userId: "approver_1" }),
		);
		expect(result.success).toBe("已批准 3 条命令请求。");
		expect(result.error).toBeUndefined();
		expect(result.results).toEqual({
			req_1: "ok",
			req_2: "ok",
			req_3: "ok",
		});
	});

	it("deduplicates repeated ids", async () => {
		await batchReviewCommandAction(
			null,
			buildFormData(["req_1", "req_1", "req_2"]),
		);
		expect(reviewCommandRequest).toHaveBeenCalledTimes(2);
	});

	it("filters blank ids before counting", async () => {
		const fd = new FormData();
		fd.set("decision", "approve");
		fd.append("commandRequestId", "");
		fd.append("commandRequestId", "  ");
		const result = await batchReviewCommandAction(null, fd);
		expect(result.error).toBe("未选中任何待审批请求");
	});

	it("collects per-id failures without blocking the rest", async () => {
		reviewCommandRequest
			.mockResolvedValueOnce(undefined) // req_1 ok
			.mockRejectedValueOnce(new Error("已被其他审批人处理")) // req_2 fail
			.mockResolvedValueOnce(undefined); // req_3 ok

		const result = await batchReviewCommandAction(
			null,
			buildFormData(["req_1", "req_2", "req_3"]),
		);

		expect(result.success).toBe("部分成功：2 条批准成功，1 条失败。");
		expect(result.results).toEqual({
			req_1: "ok",
			req_2: "已被其他审批人处理",
			req_3: "ok",
		});
	});

	it("reports total failure when every id fails", async () => {
		reviewCommandRequest.mockRejectedValue(new Error("权限不足"));
		const result = await batchReviewCommandAction(
			null,
			buildFormData(["a", "b"], "reject"),
		);
		expect(result.error).toBe("批量拒绝失败：2 条全部失败。");
		expect(result.success).toBeUndefined();
	});

	it("forwards approved=false for reject decision", async () => {
		await batchReviewCommandAction(null, buildFormData(["x"], "reject"));
		expect(reviewCommandRequest).toHaveBeenCalledWith(
			expect.objectContaining({ approved: false }),
			expect.objectContaining({ userId: "approver_1" }),
		);
	});
});

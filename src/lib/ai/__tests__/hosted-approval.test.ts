import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
	aiHostedAction: {
		findFirst: vi.fn(),
		findUnique: vi.fn(),
		update: vi.fn(),
	},
	server: { findUnique: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("ssh2", () => ({ Client: vi.fn() }));

describe("AI hosted action approvals", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("requires the approver to own the pending hosted action", async () => {
		const { approveHostedAction, rejectHostedAction } = await import("../hosted-service");
		prismaMock.aiHostedAction.findFirst.mockResolvedValue(null);

		await expect(approveHostedAction("action_1", "user_b")).rejects.toThrow("操作不存在或无权审批");
		await expect(rejectHostedAction("action_1", "user_b")).rejects.toThrow("操作不存在或无权审批");

		expect(prismaMock.aiHostedAction.findFirst).toHaveBeenCalledWith({ where: { id: "action_1", requesterId: "user_b" } });
		expect(prismaMock.aiHostedAction.update).not.toHaveBeenCalled();
	});
});

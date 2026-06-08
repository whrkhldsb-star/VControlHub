import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleKey } from "@/lib/auth/rbac";

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

	it("requires ai:action:approve instead of letting requesters self-approve dangerous actions", async () => {
		const { approveHostedAction, rejectHostedAction } = await import("../hosted-service");
		const requester: { userId: string; roles: RoleKey[] } = { userId: "user_a", roles: ["operator"] };

		await expect(approveHostedAction("action_1", requester)).rejects.toThrow("缺少权限：ai:action:approve");
		await expect(rejectHostedAction("action_1", requester)).rejects.toThrow("缺少权限：ai:action:approve");

		expect(prismaMock.aiHostedAction.findFirst).not.toHaveBeenCalled();
		expect(prismaMock.aiHostedAction.update).not.toHaveBeenCalled();
	});

	it("checks server:ssh before executing approved SSH actions", async () => {
		const { approveHostedAction } = await import("../hosted-service");
		const approver: { userId: string; roles: RoleKey[] } = { userId: "admin_1", roles: ["admin"] };
		const action = {
			id: "action_1",
			status: "PENDING_APPROVAL",
			actionType: "get_status",
			serverId: "srv_1",
			params: JSON.stringify({ serverId: "srv_1" }),
		};
		prismaMock.aiHostedAction.findFirst.mockResolvedValue(action);
		prismaMock.aiHostedAction.findUnique.mockResolvedValue({ ...action, status: "APPROVED" });
		prismaMock.server.findUnique.mockResolvedValue(null);

		await approveHostedAction("action_1", approver);

		expect(prismaMock.aiHostedAction.update).toHaveBeenCalledWith({
			where: { id: "action_1" },
			data: expect.objectContaining({ status: "APPROVED", approverId: "admin_1" }),
		});
		expect(prismaMock.server.findUnique).toHaveBeenCalledWith({ where: { id: "srv_1" }, include: { sshKey: true } });
		expect(prismaMock.aiHostedAction.update).toHaveBeenLastCalledWith({
			where: { id: "action_1" },
			data: expect.objectContaining({ status: "FAILED", errorMessage: "服务器不存在" }),
		});
	});

	it("rejects approved execution when the approver lacks server:ssh", async () => {
		const { executeSafeAction } = await import("../hosted-service");

		const result = await executeSafeAction(
			{ actionType: "get_status", serverId: "srv_1", params: { serverId: "srv_1" } },
			{ session: { userId: "viewer_1", roles: ["viewer"] } },
		);

		expect(result).toEqual({ success: false, data: null, error: "你没有服务器 SSH 执行权限" });
		expect(prismaMock.server.findUnique).not.toHaveBeenCalled();
	});
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleKey } from "@/lib/auth/rbac";

const prismaMock = vi.hoisted(() => ({
	aiHostedAction: {
		create: vi.fn(),
		findFirst: vi.fn(),
		findUnique: vi.fn(),
		update: vi.fn(),
	},
	server: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
}));

const commandServiceMock = vi.hoisted(() => ({
	createCommandRequest: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/command/service", () => commandServiceMock);
vi.mock("ssh2", () => ({ Client: vi.fn() }));

describe("AI hosted action approvals", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("requires ai:action:approve instead of letting requesters self-approve dangerous actions", async () => {
		const { approveHostedAction } = await import("../hosted-service");
		const requester: { userId: string; roles: RoleKey[] } = { userId: "user_a", roles: ["operator"] };

		await expect(approveHostedAction("action_1", requester)).rejects.toThrow("缺少权限：ai:action:approve");

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
			actionName: "获取服务器状态",
			riskLevel: "low",
			autoApproved: true,
			requesterId: "user_a",
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

	it("lets the AI list bindable VPS targets without exposing secrets", async () => {
		const { executeSafeAction } = await import("../hosted-service");
		prismaMock.server.findMany.mockResolvedValue([
			{ id: "srv_1", name: "prod-web", host: "10.0.0.8", port: 22, username: "root", enabled: true },
			{ id: "srv_2", name: "stage-db", host: "10.0.0.9", port: 2222, username: "deploy", enabled: false },
		]);

		const result = await executeSafeAction(
			{ actionType: "list_servers", serverId: null, params: {} },
			{ session: { userId: "operator_1", roles: ["operator"] }, requiredPermission: "server:read" },
		);

		expect(result).toEqual({
			success: true,
			data: {
				servers: [
					{ id: "srv_1", name: "prod-web", host: "10.0.0.8", port: 22, username: "root", enabled: true },
					{ id: "srv_2", name: "stage-db", host: "10.0.0.9", port: 2222, username: "deploy", enabled: false },
				],
			},
		});
		expect(prismaMock.server.findMany).toHaveBeenCalledWith({
			orderBy: [{ enabled: "desc" }, { name: "asc" }],
			select: { id: true, name: true, host: true, port: true, username: true, enabled: true },
		});
	});

	it("binds a natural-language VPS target but does not create a command request before user confirmation", async () => {
		const { createHostedAction } = await import("../hosted-service");
		prismaMock.server.findFirst.mockResolvedValue({ id: "srv_prod", name: "prod-web", host: "10.0.0.8" });
		prismaMock.aiHostedAction.create.mockResolvedValue({ id: "action_1", serverId: "srv_prod", status: "PENDING_APPROVAL" });

		const action = await createHostedAction({
			conversationId: "conv_1",
			messageId: "msg_1",
			toolCallId: "tool_1",
			tool: {
				name: "execute_command",
				description: "",
				parameters: {},
				riskLevel: "medium",
				autoApproved: false,
				actionType: "execute_command",
				actionName: "执行命令",
			},
			args: { serverQuery: "prod", command: "systemctl restart nginx", reason: "AI requested restart" },
			userId: "user_1",
		});

		expect(prismaMock.server.findFirst).toHaveBeenCalledWith({
			where: {
				OR: [
					{ id: "prod" },
					{ name: { contains: "prod" } },
					{ host: { contains: "prod" } },
				],
			},
			select: { id: true, name: true, host: true },
		});
		expect(commandServiceMock.createCommandRequest).not.toHaveBeenCalled();
		expect(prismaMock.aiHostedAction.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				serverId: "srv_prod",
				status: "PENDING_APPROVAL",
				params: JSON.stringify({ serverQuery: "prod", command: "systemctl restart nginx", reason: "AI requested restart", serverId: "srv_prod" }),
			}),
		});
		expect(action).toEqual({ id: "action_1", serverId: "srv_prod", status: "PENDING_APPROVAL" });
	});

	it("creates an assistant command request only after the requester confirms the AI action", async () => {
		const { confirmHostedAction } = await import("../hosted-service");
		const requester: { userId: string; roles: RoleKey[] } = { userId: "user_1", roles: ["operator"] };
		const action = {
			id: "action_1",
			status: "PENDING_APPROVAL",
			actionType: "execute_command",
			actionName: "执行命令",
			riskLevel: "medium",
			autoApproved: false,
			requesterId: "user_1",
			serverId: "srv_prod",
			params: JSON.stringify({ command: "systemctl restart nginx", reason: "AI requested restart", serverId: "srv_prod" }),
		};
		prismaMock.aiHostedAction.findFirst.mockResolvedValue(action);
		commandServiceMock.createCommandRequest.mockResolvedValue({ id: "cmd_req_1", requiresApproval: true });

		await confirmHostedAction("action_1", requester);

		expect(commandServiceMock.createCommandRequest).toHaveBeenCalledWith({
			title: "AI 助手：执行命令",
			command: "systemctl restart nginx",
			reason: "AI requested restart",
			requesterId: "user_1",
			serverIds: ["srv_prod"],
			submissionMode: "assistant",
		});
		expect(prismaMock.aiHostedAction.update).toHaveBeenCalledWith({
			where: { id: "action_1" },
			data: expect.objectContaining({
				status: "APPROVED",
				approverId: "user_1",
				result: JSON.stringify({ commandRequestId: "cmd_req_1", requiresApproval: true }),
			}),
		});
	});

	it("rejects confirmation when the pending AI action would produce an invalid command", async () => {
		const { confirmHostedAction } = await import("../hosted-service");
		const action = {
			id: "action_1",
			status: "PENDING_APPROVAL",
			actionType: "restart_service",
			actionName: "重启服务",
			riskLevel: "high",
			autoApproved: false,
			requesterId: "user_1",
			serverId: "srv_prod",
			params: JSON.stringify({ serviceName: "nginx;reboot", reason: "AI requested restart", serverId: "srv_prod" }),
		};
		prismaMock.aiHostedAction.findFirst.mockResolvedValue(action);

		await expect(confirmHostedAction("action_1", { userId: "user_1", roles: ["operator"] })).rejects.toThrow("AI 操作参数无效，无法生成可审批命令");

		expect(commandServiceMock.createCommandRequest).not.toHaveBeenCalled();
		expect(prismaMock.aiHostedAction.update).not.toHaveBeenCalled();
	});

	it("rejects confirmation when the pending AI action belongs to another requester", async () => {
		const { confirmHostedAction } = await import("../hosted-service");
		prismaMock.aiHostedAction.findFirst.mockResolvedValue(null);

		await expect(confirmHostedAction("action_1", { userId: "user_2", roles: ["operator"] })).rejects.toThrow("操作不存在或无权确认");

		expect(commandServiceMock.createCommandRequest).not.toHaveBeenCalled();
		expect(prismaMock.aiHostedAction.update).not.toHaveBeenCalled();
	});

	it("lets a requester cancel their own pending AI action without admin approval", async () => {
		const { rejectHostedAction } = await import("../hosted-service");
		const action = {
			id: "action_1",
			status: "PENDING_APPROVAL",
			requesterId: "user_1",
		};
		prismaMock.aiHostedAction.findFirst.mockResolvedValue(action);
		prismaMock.aiHostedAction.update.mockResolvedValue({ ...action, status: "REJECTED" });

		await rejectHostedAction("action_1", { userId: "user_1", roles: ["operator"] }, "用户拒绝");

		expect(prismaMock.aiHostedAction.findFirst).toHaveBeenCalledWith({
			where: { id: "action_1", requesterId: "user_1" },
		});
		expect(prismaMock.aiHostedAction.update).toHaveBeenCalledWith({
			where: { id: "action_1" },
			data: expect.objectContaining({ status: "REJECTED", approverId: "user_1", errorMessage: "用户拒绝" }),
		});
	});
});

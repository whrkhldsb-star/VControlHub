import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleKey } from "@/lib/auth/rbac";

const prismaMock = vi.hoisted(() => ({
	aiHostedAction: {
		create: vi.fn(),
		findFirst: vi.fn(),
		findUnique: vi.fn(),
		findUniqueOrThrow: vi.fn(),
		update: vi.fn(),
		updateMany: vi.fn(),
	},
	server: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
	backupRecord: { findMany: vi.fn() },
	trafficSnapshot: { findMany: vi.fn() },
	playbook: { findFirst: vi.fn() },
}));

const commandServiceMock = vi.hoisted(() => ({
	createCommandRequest: vi.fn(),
}));

const scheduledTaskServiceMock = vi.hoisted(() => ({
	listScheduledTasks: vi.fn(),
	getScheduledTask: vi.fn(),
	toggleScheduledTask: vi.fn(),
}));

const playbookServiceMock = vi.hoisted(() => ({
	runPlaybook: vi.fn(),
}));

const agentServiceMock = vi.hoisted(() => ({
	executeCommandWithAgent: vi.fn(),
}));

const sshClientMock = vi.hoisted(() => ({
	buildSshParamsFromServer: vi.fn(),
	execRemoteCommand: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/command/service", () => commandServiceMock);
vi.mock("@/lib/scheduled-task/service", () => scheduledTaskServiceMock);
vi.mock("@/lib/playbook/service", () => playbookServiceMock);
vi.mock("@/lib/server/agent-service", () => agentServiceMock);
vi.mock("@/lib/ssh/client", () => sshClientMock);
vi.mock("ssh2", () => ({ Client: vi.fn() }));

describe("AI hosted action approvals", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		prismaMock.aiHostedAction.updateMany.mockResolvedValue({ count: 1 });
	});

	it("requires ai:action:approve instead of letting requesters self-approve dangerous actions", async () => {
		const { approveHostedAction } = await import("../hosted-service");
		const requester: { userId: string; roles: RoleKey[] } = { userId: "user_a", roles: ["operator"] };

		await expect(approveHostedAction("action_1", requester)).rejects.toThrow(/ai:action:approve|permission/);

		expect(prismaMock.aiHostedAction.findFirst).not.toHaveBeenCalled();
		expect(prismaMock.aiHostedAction.update).not.toHaveBeenCalled();
	});

	it("routes administrator approval through a scoped CommandRequest instead of direct SSH", async () => {
		const { approveHostedAction } = await import("../hosted-service");
		const approver: { userId: string; roles: RoleKey[]; currentTeamId: string } = {
			userId: "admin_1",
			roles: ["admin"],
			currentTeamId: "team_a",
		};
		const action = {
			id: "action_1",
			status: "PENDING_APPROVAL",
			actionType: "execute_command",
			actionName: "Execute command",
			riskLevel: "high",
			autoApproved: false,
			requesterId: "user_a",
			teamId: "team_a",
			serverId: "srv_1",
			params: JSON.stringify({ serverId: "srv_1", command: "systemctl restart nginx" }),
		};
		prismaMock.aiHostedAction.findFirst.mockResolvedValue(action);
		prismaMock.server.findFirst.mockResolvedValue({ osDialect: null, teamId: "team_a" });
		commandServiceMock.createCommandRequest.mockResolvedValue({ id: "cmd_req_admin", requiresApproval: true });

		await approveHostedAction("action_1", approver);

		expect(prismaMock.aiHostedAction.findFirst).toHaveBeenCalledWith({
			where: { id: "action_1", teamId: "team_a" },
		});
		expect(prismaMock.aiHostedAction.updateMany).toHaveBeenCalledWith({
			where: { id: "action_1", status: "PENDING_APPROVAL", teamId: "team_a" },
			data: expect.objectContaining({ status: "APPROVED", approverId: "admin_1" }),
		});
		expect(commandServiceMock.createCommandRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				requesterId: "user_a",
				serverIds: ["srv_1"],
				teamId: "team_a",
				idempotencyKey: "ai-hosted-action:action_1",
			}),
			expect.objectContaining({ userId: "admin_1", currentTeamId: "team_a" }),
		);
		expect(prismaMock.aiHostedAction.update).toHaveBeenCalledWith({
			where: { id: "action_1" },
			data: { result: JSON.stringify({ commandRequestId: "cmd_req_admin", requiresApproval: true }) },
		});
		expect(prismaMock.server.findFirst).not.toHaveBeenCalledWith(expect.objectContaining({ include: { sshKey: true } }));
	});

	it("does not let a team approver approve another team's hosted action by id", async () => {
		const { approveHostedAction } = await import("../hosted-service");
		prismaMock.aiHostedAction.findFirst.mockResolvedValue(null);

		await expect(
			approveHostedAction("foreign_action", {
				userId: "approver_a",
				roles: ["admin"],
				currentTeamId: "team_a",
			}),
		).rejects.toThrow(/not found|不存在|authorized|无权/i);

		expect(prismaMock.aiHostedAction.findFirst).toHaveBeenCalledWith({
			where: { id: "foreign_action", teamId: "team_a" },
		});
		expect(prismaMock.aiHostedAction.updateMany).not.toHaveBeenCalled();
		expect(commandServiceMock.createCommandRequest).not.toHaveBeenCalled();
	});

	it("team-scopes administrator rejection of pending hosted actions", async () => {
		const { rejectHostedAction } = await import("../hosted-service");
		prismaMock.aiHostedAction.updateMany.mockResolvedValue({ count: 1 });
		prismaMock.aiHostedAction.findUniqueOrThrow.mockResolvedValue({ id: "action_1", status: "REJECTED" });

		await rejectHostedAction(
			"action_1",
			{ userId: "approver_a", roles: ["admin"], currentTeamId: "team_a" },
			"Rejected by team approver",
		);

		expect(prismaMock.aiHostedAction.updateMany).toHaveBeenCalledWith({
			where: { id: "action_1", status: "PENDING_APPROVAL", teamId: "team_a" },
			data: expect.objectContaining({ status: "REJECTED", approverId: "approver_a" }),
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
			{ session: { userId: "operator_1", roles: ["operator"], currentTeamId: "team_a" }, requiredPermission: "server:read" },
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
			where: { teamId: "team_a" },
			orderBy: [{ enabled: "desc" }, { name: "asc" }],
			select: { id: true, name: true, host: true, port: true, username: true, enabled: true },
			take: 500,
		});
	});

	it("runs safe status checks through Agent when the server has no SSH credential", async () => {
		const { executeSafeAction } = await import("../hosted-service");
		prismaMock.server.findFirst.mockResolvedValue({
			id: "srv_agent",
			host: "203.0.113.10",
			port: 22,
			username: "root",
			connectionType: "PASSWORD",
			managementMode: "AGENT",
			password: null,
			sshKey: null,
			hostKeySha256: "SHA256:test",
			osDialect: null,
		});
		agentServiceMock.executeCommandWithAgent.mockResolvedValue({
			stdout: "agent status output",
			stderr: "",
			exitCode: 0,
		});

		const result = await executeSafeAction(
			{ actionType: "get_status", serverId: "srv_agent", params: {} },
			{ session: { userId: "operator_1", roles: ["operator"], currentTeamId: "team_a" } },
		);

		expect(result).toMatchObject({
			success: true,
			data: { stdout: "agent status output", exitCode: 0, transport: "agent" },
		});
		expect(agentServiceMock.executeCommandWithAgent).toHaveBeenCalledWith(expect.objectContaining({ serverId: "srv_agent" }));
		expect(sshClientMock.execRemoteCommand).not.toHaveBeenCalled();
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
				actionName: "Execute command",
			},
			args: { serverQuery: "prod", command: "systemctl restart nginx", reason: "AI requested restart" },
			userId: "user_1",
			session: { userId: "user_1", roles: ["operator"], currentTeamId: "team_a" },
		});

		expect(prismaMock.server.findFirst).toHaveBeenCalledWith({
			where: {
				AND: [
					{ teamId: "team_a" }, {
						OR: [
							{ id: "prod" },
							{ name: { contains: "prod" } },
							{ host: { contains: "prod" } },
						],
					},
				],
			},
			select: { id: true, name: true, host: true },
		});
		expect(commandServiceMock.createCommandRequest).not.toHaveBeenCalled();
		expect(prismaMock.aiHostedAction.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				serverId: "srv_prod",
				teamId: "team_a",
				status: "PENDING_APPROVAL",
				params: JSON.stringify({ serverQuery: "prod", command: "systemctl restart nginx", reason: "AI requested restart", serverId: "srv_prod" }),
			}),
		});
		expect(action).toEqual({ id: "action_1", serverId: "srv_prod", status: "PENDING_APPROVAL" });
	});

	it("creates an assistant command request only after the requester confirms the AI action", async () => {
		const { confirmHostedAction } = await import("../hosted-service");
		const requester: { userId: string; roles: RoleKey[]; currentTeamId?: string | null } = {
			userId: "user_1",
			roles: ["admin"],
			currentTeamId: null,
		};
		const action = {
			id: "action_1",
			status: "PENDING_APPROVAL",
			actionType: "execute_command",
			actionName: "Execute command",
			riskLevel: "medium",
			autoApproved: false,
			requesterId: "user_1",
			teamId: "team_a",
			serverId: "srv_prod",
			params: JSON.stringify({ command: "systemctl restart nginx", reason: "AI requested restart", serverId: "srv_prod" }),
		};
		prismaMock.aiHostedAction.findFirst.mockResolvedValue(action);
		prismaMock.server.findFirst.mockResolvedValue({ osDialect: null, teamId: "team_a" });
		commandServiceMock.createCommandRequest.mockResolvedValue({ id: "cmd_req_1", requiresApproval: true });

		await confirmHostedAction("action_1", requester);

		expect(prismaMock.server.findFirst).toHaveBeenCalledWith({
			where: { id: "srv_prod", teamId: "team_a" },
			select: { osDialect: true, teamId: true },
		});
		expect(commandServiceMock.createCommandRequest).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "AI 助手：Execute command",
				command: "systemctl restart nginx",
				reason: "AI requested restart",
				requesterId: "user_1",
				serverIds: ["srv_prod"],
				submissionMode: "assistant",
				teamId: "team_a",
			}),
			expect.objectContaining({ userId: "user_1" }),
		);
		expect(prismaMock.aiHostedAction.updateMany).toHaveBeenCalledWith({
			where: { id: "action_1", status: "PENDING_APPROVAL" },
			data: expect.objectContaining({ status: "APPROVED", approverId: "user_1" }),
		});
		expect(prismaMock.aiHostedAction.update).toHaveBeenCalledWith({
			where: { id: "action_1" },
			data: { result: JSON.stringify({ commandRequestId: "cmd_req_1", requiresApproval: true }) },
		});
	});

	it("rejects confirmation when the pending AI action would produce an invalid command", async () => {
		const { confirmHostedAction } = await import("../hosted-service");
		const action = {
			id: "action_1",
			status: "PENDING_APPROVAL",
			actionType: "restart_service",
			actionName: "Restart service",
			riskLevel: "high",
			autoApproved: false,
			requesterId: "user_1",
			serverId: "srv_prod",
			params: JSON.stringify({ serviceName: "nginx;reboot", reason: "AI requested restart", serverId: "srv_prod" }),
		};
		prismaMock.aiHostedAction.findFirst.mockResolvedValue(action);

		await expect(confirmHostedAction("action_1", { userId: "user_1", roles: ["operator"] })).rejects.toThrow(/AI action parameters are invalid|AI 操作参数无效/);

		expect(commandServiceMock.createCommandRequest).not.toHaveBeenCalled();
		expect(prismaMock.aiHostedAction.update).not.toHaveBeenCalled();
	});

	it("rejects confirmation when the pending AI action belongs to another requester", async () => {
		const { confirmHostedAction } = await import("../hosted-service");
		prismaMock.aiHostedAction.findFirst.mockResolvedValue(null);

		await expect(confirmHostedAction("action_1", { userId: "user_2", roles: ["operator"] })).rejects.toThrow(/Action not found or not authorized to confirm|动作不存在或无权确认/);

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
		prismaMock.aiHostedAction.updateMany.mockResolvedValue({ count: 1 });
		prismaMock.aiHostedAction.findUniqueOrThrow.mockResolvedValue({ ...action, status: "REJECTED" });

		await rejectHostedAction("action_1", { userId: "user_1", roles: ["operator"] }, "User rejected");

		expect(prismaMock.aiHostedAction.updateMany).toHaveBeenCalledWith({
			where: { id: "action_1", status: "PENDING_APPROVAL", requesterId: "user_1" },
			data: expect.objectContaining({ status: "REJECTED", approverId: "user_1", errorMessage: "User rejected" }),
		});
		expect(prismaMock.aiHostedAction.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "action_1" } });
	});

	it("executes list_backups without requiring a bound server", async () => {
		const { executeSafeAction } = await import("../hosted-service");
		const createdAt = new Date("2026-07-01T00:00:00.000Z");
		prismaMock.backupRecord.findMany.mockResolvedValue([
			{
				id: "bk_1",
				type: "FULL",
				status: "COMPLETED",
				note: null,
				fileSize: "1024",
				createdAt,
				completedAt: createdAt,
				errorMessage: null,
			},
		]);

		const result = await executeSafeAction(
			{ actionType: "list_backups", serverId: null, params: { type: "FULL" } },
			{ session: { userId: "operator_1", roles: ["operator"], currentTeamId: "team_a" } },
		);

		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			backups: [
				{
					id: "bk_1",
					type: "FULL",
					status: "COMPLETED",
					note: null,
					fileSize: "1024",
					createdAt: createdAt.toISOString(),
					completedAt: createdAt.toISOString(),
					errorMessage: null,
				},
			],
			count: 1,
		});
		expect(prismaMock.backupRecord.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ type: "FULL" }),
				take: 50,
			}),
		);
	});

	it("lists scheduled tasks through the read-only tool without a serverId", async () => {
		const { executeSafeAction } = await import("../hosted-service");
		scheduledTaskServiceMock.listScheduledTasks.mockResolvedValue([
			{
				id: "task_1",
				name: "Nightly",
				cronExpression: "0 3 * * *",
				status: "ACTIVE",
				nextRunAt: new Date("2026-07-02T03:00:00.000Z"),
				lastRunAt: null,
				lastResult: null,
			},
		]);

		const result = await executeSafeAction(
			{ actionType: "list_scheduled_tasks", serverId: null, params: {} },
			{ session: { userId: "operator_1", roles: ["operator"], currentTeamId: "team_a" } },
		);

		expect(result.success).toBe(true);
		expect(result.data).toEqual({
			tasks: [
				{
					id: "task_1",
					name: "Nightly",
					cronExpression: "0 3 * * *",
					status: "ACTIVE",
					nextRunAt: "2026-07-02T03:00:00.000Z",
					lastRunAt: null,
					lastResult: null,
				},
			],
			count: 1,
		});
		expect(scheduledTaskServiceMock.listScheduledTasks).toHaveBeenCalledWith(
			50,
			expect.objectContaining({ userId: "operator_1", currentTeamId: "team_a" }),
		);
	});

	it("executes a scheduled-task state change only after requester confirmation", async () => {
		const { confirmHostedAction } = await import("../hosted-service");
		prismaMock.aiHostedAction.findFirst.mockResolvedValue({
			id: "action_cron",
			status: "PENDING_APPROVAL",
			actionType: "manage_cron",
			actionName: "Manage scheduled tasks",
			riskLevel: "medium",
			autoApproved: false,
			requesterId: "operator_1",
			serverId: null,
			params: JSON.stringify({ action: "pause", taskId: "task_1" }),
		});
		scheduledTaskServiceMock.getScheduledTask.mockResolvedValue({
			id: "task_1",
			status: "ACTIVE",
		});
		scheduledTaskServiceMock.toggleScheduledTask.mockResolvedValue({
			id: "task_1",
			status: "PAUSED",
		});

		await confirmHostedAction("action_cron", {
			userId: "operator_1",
			roles: ["operator"],
			currentTeamId: "team_a",
		});

		expect(prismaMock.aiHostedAction.updateMany).toHaveBeenCalledWith({
			where: { id: "action_cron", status: "PENDING_APPROVAL" },
			data: expect.objectContaining({
				status: "EXECUTING",
				approverId: "operator_1",
				executedAt: expect.any(Date),
			}),
		});
		expect(scheduledTaskServiceMock.toggleScheduledTask).toHaveBeenCalledWith(
			"task_1",
			expect.objectContaining({ userId: "operator_1", currentTeamId: "team_a" }),
		);
		expect(prismaMock.aiHostedAction.update).toHaveBeenCalledWith({
			where: { id: "action_cron" },
			data: expect.objectContaining({
				status: "COMPLETED",
				result: JSON.stringify({ id: "task_1", status: "PAUSED" }),
				errorMessage: null,
			}),
		});
		expect(commandServiceMock.createCommandRequest).not.toHaveBeenCalled();
	});

	it("does not let a read-only role confirm a scheduled-task state change", async () => {
		const { confirmHostedAction } = await import("../hosted-service");
		prismaMock.aiHostedAction.findFirst.mockResolvedValue({
			id: "action_cron",
			status: "PENDING_APPROVAL",
			actionType: "manage_cron",
			actionName: "Manage scheduled tasks",
			riskLevel: "medium",
			autoApproved: false,
			requesterId: "viewer_1",
			serverId: null,
			params: JSON.stringify({ action: "pause", taskId: "task_1" }),
		});

		await expect(
			confirmHostedAction("action_cron", {
				userId: "viewer_1",
				roles: ["viewer"],
				currentTeamId: "team_a",
			}),
		).rejects.toThrow(/permission|权限/i);

		expect(prismaMock.aiHostedAction.updateMany).not.toHaveBeenCalled();
		expect(scheduledTaskServiceMock.toggleScheduledTask).not.toHaveBeenCalled();
	});

	it("queues a playbook run on confirm for run_playbook without requiring server:ssh", async () => {
		const { confirmHostedAction } = await import("../hosted-service");
		const action = {
			id: "action_pb",
			status: "PENDING_APPROVAL",
			actionType: "run_playbook",
			actionName: "Execute Playbook",
			riskLevel: "medium",
			autoApproved: false,
			requesterId: "user_1",
			serverId: null,
			params: JSON.stringify({ playbookId: "pb_1" }),
		};
		prismaMock.aiHostedAction.findFirst.mockResolvedValue(action);
		prismaMock.playbook.findFirst.mockResolvedValue({ id: "pb_1", name: "Restart nginx fleet" });
		playbookServiceMock.runPlaybook.mockResolvedValue({ id: "run_1", status: "queued" });

		await confirmHostedAction("action_pb", {
			userId: "user_1",
			roles: ["operator"],
			currentTeamId: "team_a",
		});

		expect(commandServiceMock.createCommandRequest).not.toHaveBeenCalled();
		expect(playbookServiceMock.runPlaybook).toHaveBeenCalledWith(
			expect.objectContaining({
				playbookId: "pb_1",
				dryRun: false,
				createdById: "user_1",
			}),
		);
		expect(prismaMock.aiHostedAction.update).toHaveBeenCalledWith({
			where: { id: "action_pb" },
			data: expect.objectContaining({
				status: "COMPLETED",
				result: JSON.stringify({
					playbookId: "pb_1",
					playbookName: "Restart nginx fleet",
					runId: "run_1",
					status: "queued",
				}),
			}),
		});
	});
});

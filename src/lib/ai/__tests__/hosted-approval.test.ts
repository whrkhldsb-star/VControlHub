import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission, RoleKey } from "@/lib/auth/rbac";

const prismaMock = vi.hoisted(() => ({
	$transaction: vi.fn(),
	$queryRaw: vi.fn(),
	aiHostedAction: {
		create: vi.fn(),
		findFirst: vi.fn(),
		findMany: vi.fn(),
		findUnique: vi.fn(),
		findUniqueOrThrow: vi.fn(),
		update: vi.fn(),
		updateMany: vi.fn(),
	},
	server: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
	backupRecord: { findMany: vi.fn() },
	trafficSnapshot: { findMany: vi.fn() },
	playbook: { findFirst: vi.fn(), findMany: vi.fn() },
	playbookRun: { findFirst: vi.fn() },
	scheduledTask: { findUnique: vi.fn() },
	commandRequest: { findUnique: vi.fn() },
	aiMessage: { create: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
}));

const commandServiceMock = vi.hoisted(() => ({
	createCommandRequest: vi.fn(),
}));

const scheduledTaskServiceMock = vi.hoisted(() => ({
	createScheduledTask: vi.fn(),
	listScheduledTasks: vi.fn(),
	getScheduledTask: vi.fn(),
	toggleScheduledTask: vi.fn(),
}));

const playbookServiceMock = vi.hoisted(() => ({
	assertPlaybookCommandStepsInScope: vi.fn(),
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
		prismaMock.aiMessage.updateMany.mockResolvedValue({ count: 1 });
		prismaMock.$transaction.mockImplementation((write) => write(prismaMock));
		prismaMock.$queryRaw.mockResolvedValue([{ hostingEnabled: true, automationMode: "ASSISTED" }]);
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
			data: { status: "APPROVED", errorMessage: null, completedAt: expect.any(Date), result: JSON.stringify({ commandRequestId: "cmd_req_admin", requiresApproval: true }) },
		});
		expect(prismaMock.server.findFirst).not.toHaveBeenCalledWith(expect.objectContaining({ include: { sshKey: true } }));
	});

	it("creates no command when a rejection takes the action first", async () => {
		// The command used to be created before the PENDING->APPROVED swap: a
		// rejection that won the swap still left a command request that ran.
		const { approveHostedAction } = await import("../hosted-service");
		prismaMock.aiHostedAction.findFirst.mockResolvedValue({
			id: "action_1", status: "PENDING_APPROVAL", actionType: "execute_command", actionName: "Execute command",
			riskLevel: "high", autoApproved: false, requesterId: "user_a", teamId: "team_a", serverId: "srv_1",
			params: JSON.stringify({ serverId: "srv_1", command: "systemctl restart nginx" }),
		});
		prismaMock.server.findFirst.mockResolvedValue({ osDialect: null, teamId: "team_a" });
		prismaMock.aiHostedAction.updateMany.mockResolvedValue({ count: 0 });
		commandServiceMock.createCommandRequest.mockResolvedValue({ id: "cmd_req", requiresApproval: false });

		await expect(approveHostedAction("action_1", { userId: "admin_1", roles: ["admin"], currentTeamId: "team_a" }))
			.rejects.toThrow();
		expect(commandServiceMock.createCommandRequest).not.toHaveBeenCalled();
	});

	it.each(["confirmHostedAction", "approveHostedAction"] as const)(
		"rejects an existing change card via %s after the conversation switches to plan-only",
		async (method) => {
			const service = await import("../hosted-service");
			const { getToolByName } = await import("../hosted-tools");
			const requester = { userId: "requester", roles: ["operator"] as RoleKey[], currentTeamId: "team_a" };
			const approver = { userId: "approver", roles: ["admin"] as RoleKey[], currentTeamId: "team_a" };
			const tool = getToolByName("manage_cron")!;
			prismaMock.aiHostedAction.create.mockImplementationOnce(({ data }) => ({ id: "action_cron", ...data }));
			const action = await service.createHostedAction({
				conversationId: "conv_cron", messageId: "message", toolCallId: "call", tool,
				args: { action: "pause", taskId: "task_1" }, userId: requester.userId, session: requester,
			});
			expect(action.status).toBe("PENDING_APPROVAL");
			prismaMock.aiHostedAction.findFirst.mockResolvedValueOnce(action);
			prismaMock.$queryRaw.mockResolvedValue([{ hostingEnabled: true, automationMode: "PLAN_ONLY" }]);

			await expect(service[method](action.id, method === "confirmHostedAction" ? requester : approver))
				.rejects.toMatchObject({ name: "BusinessError", message: expect.stringMatching(/plan-only|方案模式/) });
			expect(prismaMock.$queryRaw).toHaveBeenLastCalledWith(expect.any(Array), action.conversationId);
			expect(prismaMock.aiHostedAction.updateMany).not.toHaveBeenCalled();
			expect(scheduledTaskServiceMock.toggleScheduledTask).not.toHaveBeenCalled();
		},
	);

	it.each(["confirmHostedAction", "approveHostedAction"] as const)(
		"refuses creation and %s claims under the locked hosting switch", async (method) => {
			const service = await import("../hosted-service");
			const { getToolByName } = await import("../hosted-tools");
			const actor = { userId: "admin", roles: ["admin" as const], currentTeamId: "team-a" };
			const tool = getToolByName("manage_cron")!;
			const data = { conversationId: "conv", messageId: "msg", toolCallId: "call", tool, args: { action: "pause", taskId: "task" }, userId: actor.userId, session: actor };
			prismaMock.$queryRaw.mockResolvedValue([{ hostingEnabled: false, automationMode: "ASSISTED" }]);
			await expect(service.createHostedAction(data)).rejects.toMatchObject({ name: "BusinessError" });
			prismaMock.aiHostedAction.findFirst.mockResolvedValueOnce({
				id: "action", conversationId: "conv", actionType: tool.actionType, params: JSON.stringify(data.args),
				requesterId: actor.userId, status: "PENDING_APPROVAL", autoApproved: false,
			});
			await expect(service[method]("action", actor)).rejects.toMatchObject({ name: "BusinessError" });
			const [sql] = prismaMock.$queryRaw.mock.lastCall!;
			expect(sql.join("?")).toContain('SELECT "hostingEnabled", "automationMode" FROM ai_conversations WHERE id = ? FOR SHARE');
			expect(prismaMock.aiHostedAction.create).not.toHaveBeenCalled();
			expect(prismaMock.aiHostedAction.updateMany).not.toHaveBeenCalled();
			expect(scheduledTaskServiceMock.toggleScheduledTask).not.toHaveBeenCalled();
		},
	);

	it("allows a read-only tool with a different stored action type in plan-only mode", async () => {
		const { createHostedAction } = await import("../hosted-service");
		const { getToolByName } = await import("../hosted-tools");
		prismaMock.$queryRaw.mockResolvedValueOnce([{ hostingEnabled: true, automationMode: "PLAN_ONLY" }]);
		prismaMock.aiHostedAction.create.mockImplementationOnce(({ data }) => ({ id: "status", ...data }));

		prismaMock.server.findFirst.mockResolvedValue({ id: "srv", name: "One", host: "localhost", teamId: "a" });
		const action = await createHostedAction({
			conversationId: "conv_status", messageId: "msg", toolCallId: "call",
			tool: getToolByName("get_server_status")!, args: { serverId: "srv" }, userId: "operator", session: { userId: "operator", roles: ["operator"], currentTeamId: "a" },
		});
		expect(action).toMatchObject({ actionType: "get_status", status: "APPROVED" });
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
			where: { AND: [{ teamId: "team_a" }, { OR: [
				{ userAccess: { none: { userId: "operator_1" } } },
				{ userAccess: { some: { userId: "operator_1", canRead: true } } },
			] }] },
			orderBy: [{ enabled: "desc" }, { name: "asc" }],
			select: { id: true, name: true, host: true, port: true, username: true, enabled: true },
			take: 500,
		});
	});

	it.each(["PLAN_ONLY", "ASSISTED"] as const)("refuses POSIX read tools before Windows Agent dispatch in %s", async (mode) => {
		const { executeSafeAction } = await import("../hosted-service");
		const { getToolByName, toolAvailableInMode } = await import("../hosted-tools");
		prismaMock.server.findFirst.mockResolvedValue({ id: "win", operatingSystem: "WINDOWS", managementMode: "AGENT" });
		for (const name of ["read_server_logs", "search_file_contents"]) {
			const tool = getToolByName(name)!;
			expect(toolAvailableInMode(tool, mode)).toBe(true);
			const result = await executeSafeAction({
				actionType: tool.actionType, serverId: "win", params: { path: "/logs", query: "example" },
			}, { session: { userId: "operator", roles: ["operator"], currentTeamId: "team_a" } });
			expect(result).toMatchObject({ success: false, error: expect.stringContaining("Windows") });
		}
		expect(agentServiceMock.executeCommandWithAgent).not.toHaveBeenCalled();
		expect(sshClientMock.execRemoteCommand).not.toHaveBeenCalled();
	});

	it("refuses Windows targets while validating a hosted change card", async () => {
		const { buildAssistantCommandRequestPayload } = await import("../hosted-helpers");
		const { getToolByName } = await import("../hosted-tools");
		prismaMock.server.findFirst.mockResolvedValue({ operatingSystem: "WINDOWS", osDialect: null, teamId: "team_a" });
		await expect(buildAssistantCommandRequestPayload({
			tool: getToolByName("restart_service")!, args: { serviceName: "example" },
			userId: "operator", serverId: "win", teamId: "team_a",
		})).rejects.toThrow(/Windows/);
		expect(prismaMock.server.findFirst).toHaveBeenCalledWith(expect.objectContaining({
			select: expect.objectContaining({ operatingSystem: true }),
		}));
	});

	it("refuses extra asset selectors on serverless tools before consulting inventory", async () => {
		const { createHostedAction } = await import("../hosted-service");
		const { getToolByName } = await import("../hosted-tools");
		const session = { userId: "reader", roles: [], permissions: ["ai:chat"] as Permission[], currentTeamId: "team_a" };
		await expect(createHostedAction({ conversationId: "c", messageId: "m", toolCallId: "t", userId: session.userId,
			tool: getToolByName("search_knowledge")!, args: { query: "uptime", serverQuery: "web" }, session })).rejects.toThrow();
		expect(prismaMock.server.findMany).not.toHaveBeenCalled();
		expect(prismaMock.aiHostedAction.create).not.toHaveBeenCalled();
	});

	it.each(["execute_command", "restart_service", "modify_config", "deploy_docker"])("requires command:create to propose or confirm %s", async (name) => {
		const { createHostedAction, confirmHostedAction } = await import("../hosted-service");
		const { getToolByName } = await import("../hosted-tools");
		const session = { userId: "operator", roles: [], currentTeamId: "team_a", permissions: ["ai:chat", "server:ssh"] as Permission[] };
		const args = { command: "uptime", reason: "inspect", serverId: "s", configPath: "/etc/example", content: "x", serviceName: "web", imageName: "web", containerName: "web" };
		await expect(createHostedAction({ conversationId: "c", messageId: "m", toolCallId: "t", tool: getToolByName(name)!,
			args, userId: session.userId, session })).rejects.toThrow(/command:create/);
		prismaMock.aiHostedAction.findFirst.mockResolvedValueOnce({ id: "a", conversationId: "c", status: "PENDING_APPROVAL", actionType: name, actionName: name,
			autoApproved: false, requesterId: session.userId, serverId: "s", teamId: "team_a", params: JSON.stringify(args) });
		await expect(confirmHostedAction("a", session)).rejects.toThrow(/command:create/);
		expect(commandServiceMock.createCommandRequest).not.toHaveBeenCalled();
		expect(prismaMock.aiHostedAction.updateMany).not.toHaveBeenCalled();
	});

	it("refuses a proposal with an unresolved required server", async () => {
		const { createHostedAction } = await import("../hosted-service");
		const { getToolByName } = await import("../hosted-tools");
		prismaMock.server.findFirst.mockResolvedValueOnce(null);
		await expect(createHostedAction({ conversationId: "c", messageId: "m", toolCallId: "t", userId: "u",
			tool: getToolByName("execute_command")!, args: { serverId: "missing", command: "uptime", reason: "check" },
			session: { userId: "u", roles: ["admin"], currentTeamId: "team_a" } })).rejects.toThrow();
		expect(prismaMock.aiHostedAction.create).not.toHaveBeenCalled();
	});

	it("runs safe status checks through Agent when the server has no SSH credential", async () => {
		const { executeSafeAction } = await import("../hosted-service");
		prismaMock.server.findFirst.mockResolvedValue({
			id: "srv_agent",
			agentTokenHash: "agent-identity",
			teamId: "team_a",
			operatingSystem: "LINUX",
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
		expect(agentServiceMock.executeCommandWithAgent).toHaveBeenCalledWith(expect.objectContaining({
			serverId: "srv_agent", expectedIdentity: { tokenHash: "agent-identity", teamId: "team_a" },
		}));
		expect(sshClientMock.execRemoteCommand).not.toHaveBeenCalled();
	});

	it("stops before SSH when the operator loses access while awaiting the Agent", async () => {
		const { ForbiddenError } = await import("@/lib/errors");
		const { executeSafeAction } = await import("../hosted-service");
		prismaMock.server.findFirst.mockResolvedValue({
			id: "srv", operatingSystem: "LINUX", managementMode: "AGENT", connectionType: "PASSWORD",
			password: "fixture", hostKeySha256: "SHA256:test", agentTokenHash: "fixture", teamId: "team_a",
		});
		agentServiceMock.executeCommandWithAgent.mockResolvedValueOnce(null);
		const revalidate = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ForbiddenError());
		await expect(executeSafeAction(
			{ actionType: "get_status", serverId: "srv", params: {} },
			{ session: { userId: "operator", roles: ["operator"], currentTeamId: "team_a" }, revalidate },
		)).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(revalidate).toHaveBeenCalledTimes(2);
		expect(sshClientMock.execRemoteCommand).not.toHaveBeenCalled();
	});

	it("rechecks host, credential and team access before a hosted query falls back to SSH", async () => {
		const { executeSafeAction } = await import("../hosted-service");
		const server = {
			id: "srv_agent", operatingSystem: "LINUX", managementMode: "AGENT", teamId: "team_a",
			host: "192.0.2.10", port: 22, username: "ops", hostKeySha256: "SHA256:test",
			agentTokenHash: "test-identity", connectionType: "SSH_KEY", password: null,
			sshKeyId: "key-1", sshKey: { privateKey: "fixture", updatedAt: new Date() },
		};
		agentServiceMock.executeCommandWithAgent.mockResolvedValue(null);
		const query = () => executeSafeAction({ actionType: "get_status", serverId: server.id, params: {} }, {
			session: { userId: "operator_1", roles: ["operator"], currentTeamId: "team_a" }, locale: "en",
		});

		prismaMock.server.findFirst.mockResolvedValueOnce(server).mockResolvedValueOnce(null);
		expect(await query()).toMatchObject({ success: false, error: expect.stringContaining("connection settings changed") });
		const [initial, fallback] = prismaMock.server.findFirst.mock.calls;
		expect(initial?.[0].where).toMatchObject({ enabled: true, AND: expect.any(Array) });
		expect(fallback?.[0].where).toMatchObject({
			AND: initial?.[0].where.AND, host: server.host, agentTokenHash: server.agentTokenHash,
			teamId: server.teamId, hostKeySha256: server.hostKeySha256, sshKeyId: server.sshKeyId,
			sshKey: { is: { updatedAt: server.sshKey.updatedAt } },
		});
		expect(sshClientMock.execRemoteCommand).not.toHaveBeenCalled();

		prismaMock.server.findFirst.mockResolvedValueOnce(server).mockResolvedValueOnce({ id: server.id });
		sshClientMock.buildSshParamsFromServer.mockResolvedValueOnce({ host: server.host });
		sshClientMock.execRemoteCommand.mockResolvedValueOnce({ stdout: "fixture", stderr: "", exitCode: 0 });
		expect(await query()).toMatchObject({ success: true, data: { transport: "ssh" } });
	});

	it("refuses, when it is proposed, a change that could never become a command request", async () => {
		// Parameters the command builder refuses and a file too long for one request were only found out when
		// the person confirmed: the action then failed with a validation dump. The model gets the answer now.
		const { createHostedAction } = await import("../hosted-service");
		prismaMock.server.findFirst.mockResolvedValue({ id: "srv_prod", name: "prod-web", host: "10.0.0.8", teamId: "team_a" });
		prismaMock.server.findUnique.mockResolvedValue({ teamId: "team_a" });
		prismaMock.aiHostedAction.create.mockResolvedValue({ id: "action_1", serverId: "srv_prod", status: "PENDING_APPROVAL" });
		const tool = { name: "modify_config", description: "", parameters: {}, riskLevel: "high" as const, autoApproved: false, actionType: "modify_config" as const, actionName: "Modify config file" };
		const propose = (args: Record<string, unknown>) => createHostedAction({
			conversationId: "conv_1", messageId: "msg_1", toolCallId: "tool_1", tool, args: { serverId: "srv_prod", ...args },
			userId: "user_1", session: { userId: "user_1", roles: ["operator"], currentTeamId: "team_a" },
		});

		// 10,000 characters of content pass the builder; with the heredoc around them the command is too long.
		await expect(propose({ configPath: "/etc/app.conf", content: "x".repeat(10_000), reason: "tune" })).rejects.toThrow(/too long/i);
		await expect(propose({ configPath: "../etc/app.conf", content: "x", reason: "tune" })).rejects.toThrow();
		expect(prismaMock.aiHostedAction.create).not.toHaveBeenCalled();

		await propose({ configPath: "/etc/app.conf", content: "listen 8080;", reason: "tune" });
		expect(prismaMock.aiHostedAction.create).toHaveBeenCalledTimes(1);
	});

	it("cuts the assistant's reason to what a command request takes", async () => {
		const { buildAssistantCommandRequestPayload } = await import("../hosted-helpers");
		const { createCommandSchema } = await import("@/lib/command/schema");
		prismaMock.server.findFirst.mockResolvedValue({ osDialect: null, teamId: "team_a" });
		const payload = await buildAssistantCommandRequestPayload({
			tool: { name: "execute_command", description: "", parameters: {}, riskLevel: "medium", autoApproved: false, actionType: "execute_command", actionName: "Execute command" },
			args: { command: "uptime", reason: "because ".repeat(200) },
			userId: "user_1", serverId: "srv_prod", teamId: "team_a",
		});
		expect(payload.reason).toHaveLength(500);
		expect(createCommandSchema.safeParse(payload).success).toBe(true);
	});

	it("binds a natural-language VPS target but does not create a command request before user confirmation", async () => {
		const { createHostedAction } = await import("../hosted-service");
		prismaMock.server.findFirst.mockResolvedValue({ id: "srv_prod", name: "prod-web", host: "10.0.0.8", teamId: "team_a" });
		// No server is called exactly "prod"; one contains it.
		prismaMock.server.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "srv_prod", name: "prod-web", host: "10.0.0.8" }]);
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

		expect(prismaMock.server.findMany).toHaveBeenLastCalledWith({
			where: {
				AND: [
					{ AND: [{ teamId: "team_a" }, { OR: [
						{ userAccess: { none: { userId: "user_1" } } },
						{ userAccess: { some: { userId: "user_1", canRead: true } } },
					] }] }, {
						OR: [
							{ name: { contains: "prod", mode: "insensitive" } },
							{ host: { contains: "prod", mode: "insensitive" } },
						],
					},
				],
			},
			select: { id: true, name: true, host: true },
			orderBy: { name: "asc" },
			take: 6,
		});
		expect(commandServiceMock.createCommandRequest).not.toHaveBeenCalled();
		expect(prismaMock.aiHostedAction.create).toHaveBeenCalledWith({
			// The card names the server it is bound to.
			data: expect.objectContaining({
				serverId: "srv_prod",
				teamId: "team_a",
				status: "PENDING_APPROVAL",
				params: JSON.stringify({ serverQuery: "prod", command: "systemctl restart nginx", reason: "AI requested restart", serverId: "srv_prod", serverSnapshot: { id: "srv_prod", name: "prod-web", host: "10.0.0.8" } }),
			}),
		});
		expect(action).toMatchObject({ id: "action_1", serverId: "srv_prod", status: "PENDING_APPROVAL" });
	});

	it("resolves the playbook when a run is proposed, so the card names the one that will run", async () => {
		// The name used to be matched at confirm time against everything containing it, taking the most recently updated.
		const { createHostedAction } = await import("../hosted-service");
		const tool = {
			name: "run_playbook",
			description: "",
			parameters: {},
			riskLevel: "medium" as const,
			autoApproved: false,
			actionType: "run_playbook" as const,
			actionName: "Execute Playbook",
		};
		const session = { userId: "user_1", roles: ["operator"] as RoleKey[], currentTeamId: "team_a" };
		prismaMock.playbook.findMany.mockResolvedValueOnce([{ id: "pb_9", name: "Nightly cleanup", enabled: true, steps: [] }]);
		prismaMock.aiHostedAction.create.mockResolvedValue({ id: "action_1" });

		await createHostedAction({ conversationId: "c", messageId: "m", toolCallId: "t", tool, args: { playbookName: "Nightly cleanup" }, userId: "user_1", session });
		expect(prismaMock.aiHostedAction.create).toHaveBeenCalledWith(expect.objectContaining({
			data: expect.objectContaining({ params: JSON.stringify({ playbookName: "Nightly cleanup", playbookId: "pb_9", targetServerIds: [] }) }),
		}));

		// A name that fits no playbook (or several) is an error for the model to correct, not a card.
		prismaMock.aiHostedAction.create.mockClear();
		prismaMock.playbook.findMany.mockResolvedValue([]);
		await expect(createHostedAction({ conversationId: "c", messageId: "m", toolCallId: "t2", tool, args: { playbookName: "nothing like it" }, userId: "user_1", session })).rejects.toThrow();
		expect(prismaMock.aiHostedAction.create).not.toHaveBeenCalled();
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
			params: JSON.stringify({ command: "systemctl restart nginx", reason: "AI requested restart", serverId: "srv_prod", serverSnapshot: { id: "srv_prod", name: "prod-web", host: "10.0.0.8" } }),
		};
		prismaMock.aiHostedAction.findFirst.mockResolvedValue(action);
		prismaMock.server.findFirst.mockResolvedValue({ osDialect: null, teamId: "team_a" });
		commandServiceMock.createCommandRequest.mockResolvedValue({ id: "cmd_req_1", requiresApproval: true });

		await confirmHostedAction("action_1", requester);

		expect(prismaMock.server.findFirst).toHaveBeenCalledWith({
			where: { id: "srv_prod", teamId: "team_a" },
			select: { operatingSystem: true, osDialect: true, teamId: true },
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
			data: { status: "APPROVED", errorMessage: null, completedAt: expect.any(Date), result: JSON.stringify({ commandRequestId: "cmd_req_1", requiresApproval: true }) },
		});
	});

	it("records a command whose creation committed although the call failed, not a failed action", async () => {
		const { confirmHostedAction } = await import("../hosted-service");
		prismaMock.aiHostedAction.findFirst.mockResolvedValue({
			id: "action_lost",
			status: "PENDING_APPROVAL",
			actionType: "execute_command",
			actionName: "Execute command",
			riskLevel: "medium",
			autoApproved: false,
			requesterId: "user_1",
			teamId: "team_a",
			serverId: "srv_prod",
			conversationId: "conv_1",
			toolCallId: null,
			params: JSON.stringify({ command: "uptime", reason: "check", serverId: "srv_prod" }),
		});
		prismaMock.server.findFirst.mockResolvedValue({ osDialect: null, teamId: "team_a" });
		commandServiceMock.createCommandRequest.mockRejectedValueOnce(new Error("connection reset"));
		prismaMock.commandRequest.findUnique.mockResolvedValueOnce({ id: "cmd_lost", status: "PENDING_APPROVAL" });

		await expect(confirmHostedAction("action_lost", { userId: "user_1", roles: ["admin"], currentTeamId: null })).resolves.toBeUndefined();

		expect(prismaMock.commandRequest.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { idempotencyKey: "ai-hosted-action:action_lost", teamId: "team_a", initiatedByType: "ASSISTANT" } }));
		expect(prismaMock.aiHostedAction.update).toHaveBeenCalledWith({
			where: { id: "action_lost" },
			data: { status: "APPROVED", errorMessage: null, completedAt: expect.any(Date), result: JSON.stringify({ commandRequestId: "cmd_lost", requiresApproval: true }) },
		});
		expect(prismaMock.aiHostedAction.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
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
			params: JSON.stringify({ serviceName: "nginx;reboot", reason: "AI requested restart", serverId: "srv_prod", serverSnapshot: { id: "srv_prod", name: "prod-web", host: "10.0.0.8" } }),
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
			where: { id: "action_1", status: "PENDING_APPROVAL", requesterId: "user_1", teamId: "__no_active_team__" },
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
			{ session: { userId: "operator_1", roles: ["admin"], currentTeamId: "team_a" } },
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
			where: { id: "action_cron", status: "PENDING_APPROVAL", teamId: "team_a" },
			data: expect.objectContaining({
				status: "EXECUTING",
				approverId: "operator_1",
				executedAt: expect.any(Date),
			}),
		});
		expect(scheduledTaskServiceMock.toggleScheduledTask).toHaveBeenCalledWith(
			"task_1",
			expect.objectContaining({ userId: "operator_1", currentTeamId: "team_a" }),
			"PAUSED",
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
			roles: [],
			permissions: ["playbook:run", "command:execute"],
			currentTeamId: "team_a",
		});

		expect(commandServiceMock.createCommandRequest).not.toHaveBeenCalled();
		expect(playbookServiceMock.runPlaybook).toHaveBeenCalledWith(
			expect.objectContaining({
				playbookId: "pb_1",
				dryRun: false,
				createdById: "user_1",
				session: expect.objectContaining({ roles: [], permissions: ["playbook:run", "command:execute"] }),
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

	it("preserves identity-template permissions when confirming commands", async () => {
		const { confirmHostedAction } = await import("../hosted-service");
		const requester = {
			userId: "customer_user", roles: [] as RoleKey[], currentTeamId: "team_a",
			permissions: ["server:ssh", "command:create", "command:approve"] as Permission[],
		};
		prismaMock.aiHostedAction.findFirst.mockResolvedValue({
			id: "action_custom", status: "PENDING_APPROVAL", actionType: "execute_command",
			actionName: "Read status", riskLevel: "low", autoApproved: false,
			requesterId: requester.userId, serverId: "srv_1", teamId: "team_a",
			params: JSON.stringify({ command: "uptime", reason: "Check status" }),
		});
		prismaMock.server.findFirst.mockResolvedValue({ osDialect: null, teamId: "team_a" });
		commandServiceMock.createCommandRequest.mockResolvedValue({ id: "request_1", requiresApproval: false });
		await confirmHostedAction("action_custom", requester);
		expect(commandServiceMock.createCommandRequest).toHaveBeenCalledWith(
			expect.objectContaining({ idempotencyKey: "ai-hosted-action:action_custom" }), requester,
		);
		expect(prismaMock.aiHostedAction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
			where: { id: "action_custom", status: "PENDING_APPROVAL", teamId: "team_a" },
		}));
	});

	it.each(["execute_command", "run_playbook"])("records failed %s confirmation instead of leaving it approved", async (actionType) => {
		const { confirmHostedAction } = await import("../hosted-service");
		prismaMock.aiHostedAction.findFirst.mockResolvedValue({
			id: "action_failed", status: "PENDING_APPROVAL", actionType,
			actionName: "Check status", riskLevel: "low", autoApproved: false,
			requesterId: "user_1", serverId: actionType === "run_playbook" ? null : "srv_1", teamId: "team_a",
			params: JSON.stringify({ command: "uptime", playbookId: "pb_1" }),
		});
		prismaMock.server.findFirst.mockResolvedValue({ osDialect: null, teamId: "team_a" });
		prismaMock.playbook.findFirst.mockResolvedValue({ id: "pb_1", name: "Check status" });
		const executor = actionType === "run_playbook" ? playbookServiceMock.runPlaybook : commandServiceMock.createCommandRequest;
		executor.mockRejectedValueOnce(new Error("Target no longer available"));
		await expect(confirmHostedAction("action_failed", {
			userId: "user_1", roles: ["admin"], currentTeamId: "team_a",
		})).resolves.toBeUndefined();
		expect(prismaMock.aiHostedAction.update).toHaveBeenCalledWith({
			where: { id: "action_failed" },
			data: { status: "FAILED", errorMessage: "Target no longer available", completedAt: expect.any(Date) },
		});
	});

	it.each(["confirmHostedAction", "approveHostedAction"] as const)(
		"binds an all-customers proposal to its targets and rejects a transfer via %s",
		async (method) => {
			const service = await import("../hosted-service");
			const { getToolByName } = await import("../hosted-tools");
			const actor = { userId: "admin", roles: ["admin"] as RoleKey[], currentTeamId: null };
			const server = { id: "srv", name: "One host", host: "127.0.0.1" };
			prismaMock.server.findMany.mockResolvedValueOnce([{ ...server, teamId: "team_a" }]);
			prismaMock.aiHostedAction.create.mockImplementationOnce(({ data }) => ({ id: "card", ...data }));
			const card = await service.createHostedAction({
				conversationId: "c1", messageId: "msg", toolCallId: "call",
				tool: getToolByName("create_automation_task")!,
				args: {
					name: "Status", plan: "Check uptime", reason: "Health", executionMode: "daily", dailyTime: "02:00",
					targetScope: "selected", serverIds: ["srv"], command: "uptime", approvalMode: "every_run",
				},
				userId: actor.userId, session: actor,
			});
			expect(card.teamId).toBe("team_a");
			expect(JSON.parse(card.params)).toMatchObject({ serverIds: ["srv"], teamId: "team_a" });

			prismaMock.aiHostedAction.findFirst.mockResolvedValueOnce(card);
			prismaMock.server.findMany.mockResolvedValueOnce([{ ...server, teamId: "team_b" }]);
			await service[method](card.id, actor);
			expect(prismaMock.aiHostedAction.update).toHaveBeenCalledWith(expect.objectContaining({
				data: expect.objectContaining({ status: "FAILED", errorMessage: expect.stringMatching(/新.*方案|new plan/i) }),
			}));
			expect(scheduledTaskServiceMock.createScheduledTask).not.toHaveBeenCalled();
			expect(commandServiceMock.createCommandRequest).not.toHaveBeenCalled();
		},
	);

	it("leaves a committed schedule recoverable when saving its tool reply fails", async () => {
		const { confirmHostedAction } = await import("../hosted-service");
		const actor = { userId: "u1", roles: ["admin"] as RoleKey[], currentTeamId: "team_a" };
		const params = {
			name: "Daily health", plan: "Read uptime daily", reason: "Health", executionMode: "daily",
			targetScope: "selected", dailyTime: "02:00", serverIds: ["srv"], teamId: "team_a",
			command: "uptime", approvalMode: "every_run",
		};
		prismaMock.aiHostedAction.findFirst.mockResolvedValueOnce({
			id: "card", actionType: "create_automation_task", teamId: "team_a", status: "PENDING_APPROVAL",
			params: JSON.stringify(params), toolCallId: "call", conversationId: "conversation",
		});
		prismaMock.server.findMany.mockResolvedValueOnce([{ id: "srv", name: "One", host: "localhost", teamId: "team_a" }]);
		scheduledTaskServiceMock.createScheduledTask.mockResolvedValueOnce({ id: "ai-automation:card", scheduleType: "CRON", nextRunAt: null });
		prismaMock.aiMessage.updateMany.mockRejectedValueOnce(new Error("connection lost"));

		await expect(confirmHostedAction("card", actor)).resolves.toBeUndefined();
		expect(prismaMock.aiHostedAction.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED", completedAt: null }) }));
		expect(scheduledTaskServiceMock.createScheduledTask).toHaveBeenCalledWith(
			expect.objectContaining({ teamId: "team_a" }), actor, "ai-automation:card",
		);
		expect(prismaMock.aiHostedAction.update).not.toHaveBeenCalledWith(
			expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
		);
	});

	it("settles interrupted approvals and executions from durable artifacts without redispatch", async () => {
		const { recoverInterruptedHostedActions } = await import("../hosted-service");
		const approvedAt = new Date("2026-10-20T00:00:00Z");
		const cutoff = new Date("2026-10-20T00:30:00Z");
		const now = new Date("2026-10-20T01:00:00Z");
		const base = { conversationId: "c1", teamId: "team_a", result: null, completedAt: null, approvedAt, executedAt: null, status: "APPROVED", params: "{}" };
		const actions = [
			{ ...base, id: "ordinary", actionType: "restart_service", params: "{damaged", toolCallId: "call1" },
			{ ...base, id: "playbook", actionType: "run_playbook", toolCallId: "call2" },
			{ ...base, id: "immediate", actionType: "create_automation_task", params: '{"executionMode":"now"}', status: "EXECUTING", executedAt: approvedAt, toolCallId: "call3" },
			{ ...base, id: "timer", actionType: "create_automation_task", status: "EXECUTING", executedAt: approvedAt, params: '{"executionMode":"once"}', toolCallId: "call4" },
			{ ...base, id: "uncertain", actionType: "manage_cron", status: "EXECUTING", executedAt: approvedAt, toolCallId: "call5" },
			{ ...base, id: "legacy", actionType: "create_automation_task", status: "EXECUTING", executedAt: approvedAt, params: '{"executionMode":"daily"}', toolCallId: "call6" },
			{ ...base, id: "finished", actionType: "get_status", toolCallId: "call7" },
			{ ...base, id: "receipt", actionType: "restart_service", result: '{"commandRequestId":"old","requiresApproval":true}', toolCallId: "call8" },
		];
		prismaMock.aiHostedAction.findMany.mockResolvedValueOnce(actions);
		prismaMock.commandRequest.findUnique.mockResolvedValueOnce({ id: "cmd", status: "PENDING_APPROVAL" })
			.mockResolvedValueOnce({ id: "cmd2", status: "APPROVED" });
		prismaMock.playbookRun.findFirst.mockResolvedValueOnce({ id: "run", playbookId: "pb", status: "running" });
		prismaMock.scheduledTask.findUnique.mockResolvedValueOnce({ id: "ai-automation:timer", scheduleType: "ONCE" })
			.mockResolvedValueOnce(null);
		prismaMock.aiHostedAction.updateMany.mockImplementation(({ where }) => ({ count: where.id === "finished" ? 0 : 1 }));
		expect(await recoverInterruptedHostedActions(now)).toEqual({ recovered: 7 });
		expect(prismaMock.aiHostedAction.findMany).toHaveBeenCalledWith(expect.objectContaining({
			where: { OR: [{ completedAt: null, OR: [
				{ status: { in: ["FAILED", "COMPLETED"] } },
				{ status: "EXECUTING", executedAt: { lt: cutoff } },
				{ status: "APPROVED", approvedAt: { lt: cutoff } },
				{ status: "EXECUTING", executedAt: null, createdAt: { lt: cutoff } },
				{ status: "APPROVED", approvedAt: null, createdAt: { lt: cutoff } },
			] }, { status: "APPROVED", result: JSON.stringify({ verified: false, pendingRecheck: true }), completedAt: { lt: cutoff } }] },
		}));
		expect(prismaMock.commandRequest.findUnique.mock.calls.map(([query]) => query.where.idempotencyKey))
			.toEqual(["ai-hosted-action:ordinary", "ai-automation:immediate"]);
		expect(prismaMock.playbookRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
			where: { AND: [
				{ triggerContext: { path: ["source"], equals: "ai_hosted_action" } },
				{ triggerContext: { path: ["hostedActionId"], equals: "playbook" } },
			] },
		}));
		expect(prismaMock.scheduledTask.findUnique).toHaveBeenCalledWith(expect.objectContaining({
			where: { id: "ai-automation:timer" },
		}));
		const messages = prismaMock.aiMessage.updateMany.mock.calls.map(([query]) => JSON.parse(query.data.content));
		expect(messages).toMatchObject([
			{ actionId: "ordinary", status: "APPROVED", commandRequestId: "cmd", requiresApproval: true },
			{ actionId: "playbook", status: "COMPLETED", runId: "run" },
			{ actionId: "immediate", status: "COMPLETED", data: { commandRequestId: "cmd2" } },
			{ actionId: "timer", status: "COMPLETED", data: { scheduledTaskId: "ai-automation:timer" } },
			{ actionId: "uncertain", status: "FAILED", error: expect.any(String) },
			{ actionId: "legacy", status: "APPROVED", error: expect.any(String) },
			{ actionId: "receipt", status: "APPROVED", commandRequestId: "old" },
		]);
		expect(prismaMock.aiHostedAction.updateMany).toHaveBeenCalledWith({
			where: { id: "ordinary", approvedAt, executedAt: null, status: "APPROVED", result: null, completedAt: null },
			data: expect.objectContaining({ status: "APPROVED", result: expect.stringContaining("cmd") }),
		});
		expect(commandServiceMock.createCommandRequest).not.toHaveBeenCalled();
		expect(playbookServiceMock.runPlaybook).not.toHaveBeenCalled();
		expect(scheduledTaskServiceMock.createScheduledTask).not.toHaveBeenCalled();
	});

	it("rechecks an approval whose command committed just after the first lookup", async () => {
		const { recoverInterruptedHostedActions } = await import("../hosted-service");
		const action = {
			id: "late", actionType: "execute_command", params: "{}", teamId: "team_a", toolCallId: "call",
			conversationId: "c1", status: "APPROVED", result: null, completedAt: null,
			approvedAt: new Date("2026-10-20T00:00:00Z"), executedAt: null,
		};
		const firstScan = new Date("2026-10-20T02:00:00Z");
		prismaMock.aiHostedAction.findMany.mockResolvedValueOnce([action]);
		prismaMock.commandRequest.findUnique.mockResolvedValueOnce(null);
		await recoverInterruptedHostedActions(firstScan);
		const firstUpdate = prismaMock.aiHostedAction.updateMany.mock.calls[0]![0].data;
		expect(firstUpdate).toMatchObject({ status: "APPROVED", completedAt: firstScan });
		expect(JSON.parse(firstUpdate.result)).toEqual({ verified: false, pendingRecheck: true });
		prismaMock.aiHostedAction.findMany.mockResolvedValueOnce([{ ...action, ...firstUpdate }]);
		prismaMock.commandRequest.findUnique.mockResolvedValueOnce({ id: "late-command", status: "APPROVED" });
		await recoverInterruptedHostedActions(new Date("2026-10-20T03:00:00Z"));
		expect(prismaMock.aiMessage.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
			data: { content: expect.stringContaining('"commandRequestId":"late-command"') },
		}));
		expect(commandServiceMock.createCommandRequest).not.toHaveBeenCalled();
	});

	it("lists only the requester's pending actions in the selected customer", async () => {
		const { getPendingActions } = await import("../hosted-service");
		prismaMock.aiHostedAction.findMany.mockResolvedValue([]);
		await getPendingActions({ userId: "user_1", roles: ["admin"], currentTeamId: "team_a" });
		expect(prismaMock.aiHostedAction.findMany).toHaveBeenCalledWith(expect.objectContaining({
			where: { status: "PENDING_APPROVAL", requesterId: "user_1", teamId: "team_a", conversation: { teamId: "team_a" } },
		}));
	});

});

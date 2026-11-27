import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirstMock, withVisibleCommandLogsMock } = vi.hoisted(() => ({
	findFirstMock: vi.fn(),
	withVisibleCommandLogsMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
	prisma: {
		commandRequest: {
			findFirst: findFirstMock,
		},
	},
	isUniqueViolation: () => false,
}));

vi.mock("../visibility", () => ({
	RECENT_COMMAND_LOG_LIMIT: 5,
	withVisibleCommandLogs: withVisibleCommandLogsMock,
}));

import { getCommandRequestForViewer } from "../service-requests";

const baseRow = {
	id: "cmd_1",
	title: "Restart nginx",
	command: "systemctl restart nginx",
	reason: "Maintenance",
	status: "PENDING_APPROVAL",
	initiatedByType: "USER",
	requesterId: "user_1",
	teamId: "team_a",
	idempotencyKey: null,
	createdAt: new Date("2026-06-01T00:00:00.000Z"),
	updatedAt: new Date("2026-06-01T00:00:00.000Z"),
	requester: { id: "user_1", username: "alice", displayName: "Alice" },
	scheduledTaskRuns: [],
	approvals: [],
	_count: { targets: 2 },
	targets: [
		{
			id: "t_same",
			status: "PENDING_APPROVAL",
			executionChannel: null,
			fallbackReason: null,
			outcomeUnknown: false,
			finishedAt: null,
			server: { id: "srv_1", name: "node-a", host: "10.0.0.1", port: 22, teamId: "team_a" },
		},
		{
			id: "t_moved",
			status: "PENDING_APPROVAL",
			executionChannel: null,
			fallbackReason: null,
			outcomeUnknown: false,
			finishedAt: null,
			server: { id: "srv_2", name: "node-b", host: "10.0.0.2", port: 22, teamId: "team_b" },
		},
	],
	executionLogs: [
		{ id: "log_1", summary: "queued", exitCode: null, stdout: null, stderr: null, createdAt: new Date("2026-06-01T00:01:00.000Z") },
	],
};

describe("getCommandRequestForViewer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		withVisibleCommandLogsMock.mockImplementation(async (rows: unknown[]) => rows);
	});

	it("returns null for empty, overly long, missing, or out-of-scope IDs", async () => {
		const session = { userId: "u1", roles: ["operator" as const], currentTeamId: "team_a" };
		expect(await getCommandRequestForViewer(session, "   ")).toBeNull();
		expect(await getCommandRequestForViewer(session, "x".repeat(65))).toBeNull();
		expect(findFirstMock).not.toHaveBeenCalled();

		findFirstMock.mockResolvedValueOnce(null);
		expect(await getCommandRequestForViewer(session, "missing_or_other_team")).toBeNull();
		expect(findFirstMock).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ id: "missing_or_other_team", teamId: "team_a" }),
			}),
		);
	});

	it("drops targets whose server moved to another team while keeping same-team targets and logs", async () => {
		const session = { userId: "u1", roles: ["operator" as const], currentTeamId: "team_a" };
		findFirstMock.mockResolvedValueOnce(baseRow);

		const result = await getCommandRequestForViewer(session, "cmd_1");
		expect(result).not.toBeNull();
		expect(result?.targets).toHaveLength(1);
		expect(result?.targets[0]?.id).toBe("t_same");
		expect(result?.targetCount).toBe(1);
		expect(result?.executionLogs).toHaveLength(1);
		expect(withVisibleCommandLogsMock).toHaveBeenCalledWith([baseRow], session);
	});

	it("redacts targets and execution logs for a viewer without server:read", async () => {
		const session = { userId: "u1", roles: [], currentTeamId: "team_a" };
		findFirstMock.mockResolvedValueOnce(baseRow);

		const result = await getCommandRequestForViewer(session, "cmd_1");
		expect(result).not.toBeNull();
		expect(result?.targets).toEqual([]);
		expect(result?.targetCount).toBe(0);
		expect(result?.executionLogs).toEqual([]);
		expect(findFirstMock).toHaveBeenCalledWith(
			expect.objectContaining({
				include: expect.objectContaining({
					targets: expect.objectContaining({
						where: { server: { id: { in: [] } } },
					}),
				}),
			}),
		);
	});
});

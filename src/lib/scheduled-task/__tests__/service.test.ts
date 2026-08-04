import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleKey } from "@/lib/auth/rbac";
import type { SessionScope } from "../service";

const { mockPrisma, mockCreateCommandRequest, mockTeamWhere, mockTeamCreateData, mockNotifyTaskConsecutiveFailed } = vi.hoisted(() => ({
  mockPrisma: {
    scheduledTask: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
			updateMany: vi.fn(),
      delete: vi.fn(),
    },
		scheduledTaskRun: {
			findUnique: vi.fn(),
			findMany: vi.fn(),
			findFirst: vi.fn(),
			create: vi.fn(),
			updateMany: vi.fn(),
		},
    server: {
      findMany: vi.fn(),
    },
		$transaction: vi.fn(),
  },
  mockCreateCommandRequest: vi.fn(),
  mockTeamWhere: vi.fn(),
  mockTeamCreateData: vi.fn(),
  mockNotifyTaskConsecutiveFailed: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/command/service", () => ({ createCommandRequest: mockCreateCommandRequest }));
vi.mock("@/lib/notification/service", () => ({
  notifyTaskConsecutiveFailed: mockNotifyTaskConsecutiveFailed,
}));
vi.mock("@/lib/auth/team-scope", () => ({
  teamWhere: mockTeamWhere,
  serverTeamWhere: (session: { roles?: string[]; currentTeamId?: string | null }) => {
    if (session.roles?.includes("admin")) return {};
    return session.currentTeamId
      ? { teamId: session.currentTeamId }
      : { id: "__unassigned_servers_require_team_manage__" };
  },
  teamCreateData: mockTeamCreateData,
}));

const service = await import("../service");

const teamSession: SessionScope = {
  userId: "u1",
  roles: ["operator"] as RoleKey[],
  currentTeamId: "team_a",
};

describe("scheduled task service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTeamWhere.mockReturnValue({ OR: [{ teamId: "team_a" }, { teamId: null }] });
    mockTeamCreateData.mockReturnValue({ teamId: "team_a" });
		mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma));
		mockPrisma.scheduledTaskRun.findUnique.mockResolvedValue(null);
		mockPrisma.scheduledTaskRun.create.mockResolvedValue({ id: "run1" });
    mockPrisma.server.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
      (where.id.in ?? []).map((id: string) => ({ id })),
    );
  });

  it("stores scheduled task target server ids exactly once after trimming blanks", async () => {
    mockPrisma.scheduledTask.create.mockResolvedValue({ id: "task1" });

    await service.createScheduledTask({
      name: "Clean logs",
      cronExpression: "0 2 * * *",
      command: "df -h",
      serverIds: [" srv1 ", "srv1", "", "srv2"],
      createdById: "u1",
    });

    expect(mockPrisma.scheduledTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        serverIds: ["srv1", "srv2"],
        teamId: null,
      }),
    });
  });

  it("assigns teamId from session on create when present", async () => {
    mockPrisma.scheduledTask.create.mockResolvedValue({ id: "task1", teamId: "team_a" });

    await service.createScheduledTask(
      {
        name: "Clean logs",
        cronExpression: "0 2 * * *",
        command: "df -h",
        serverIds: ["srv1"],
        createdById: "u1",
      },
      teamSession,
    );

    expect(mockTeamCreateData).toHaveBeenCalledWith(teamSession);
    expect(mockPrisma.scheduledTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        teamId: "team_a",
        createdById: "u1",
      }),
    });
  });

  it("updates scheduled task target server ids exactly once after trimming blanks", async () => {
    mockPrisma.scheduledTask.findFirst.mockResolvedValue({ id: "task1", teamId: null });
    mockPrisma.scheduledTask.update.mockResolvedValue({ id: "task1" });

    await service.updateScheduledTask("task1", {
      serverIds: ["srv1", " srv2 ", "srv1", ""],
    });

    expect(mockPrisma.scheduledTask.update).toHaveBeenCalledWith({
      where: { id: "task1" },
      data: { serverIds: ["srv1", "srv2"] },
    });
  });

  it("bounds scheduled task list hydration newest-first", async () => {
    mockPrisma.scheduledTask.findMany.mockResolvedValue([]);

    await service.listScheduledTasks();

    expect(mockPrisma.scheduledTask.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { creator: { select: { username: true, displayName: true } } },
    });
  });

  it("scopes list queries with teamWhere when session is provided", async () => {
    mockPrisma.scheduledTask.findMany.mockResolvedValue([]);

    await service.listScheduledTasks(50, teamSession);

    expect(mockTeamWhere).toHaveBeenCalledWith(teamSession);
    expect(mockPrisma.scheduledTask.findMany).toHaveBeenCalledWith({
      where: { OR: [{ teamId: "team_a" }, { teamId: null }] },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { creator: { select: { username: true, displayName: true } } },
    });
  });

  it("rejects mutate when task is outside team scope", async () => {
    mockPrisma.scheduledTask.findFirst.mockResolvedValue(null);

    await expect(
      service.updateScheduledTask("foreign_task", { name: "x" }, teamSession),
    ).rejects.toMatchObject({ name: "NotFoundError" });

    await expect(
      service.deleteScheduledTask("foreign_task", teamSession),
    ).rejects.toMatchObject({ name: "NotFoundError" });

    await expect(
      service.toggleScheduledTask("foreign_task", teamSession),
    ).rejects.toMatchObject({ name: "NotFoundError" });

    await expect(
      service.retryScheduledTask("foreign_task", teamSession),
    ).rejects.toMatchObject({ name: "NotFoundError" });

    expect(mockPrisma.scheduledTask.update).not.toHaveBeenCalled();
    expect(mockPrisma.scheduledTask.delete).not.toHaveBeenCalled();
  });

  it("retries a scheduled task by creating a command request and recording the manual trigger", async () => {
    mockPrisma.scheduledTask.findFirst.mockResolvedValue({
      id: "task1",
      name: "Clean logs",
      cronExpression: "0 2 * * *",
      command: "df -h",
      reason: "maintenance",
      serverIds: ["srv1"],
      createdById: "u1",
    });
    mockPrisma.scheduledTask.findUnique.mockResolvedValue({
      cronExpression: "0 2 * * *",
    });
    mockCreateCommandRequest.mockResolvedValue({ id: "cmd1" });
    mockPrisma.scheduledTask.update.mockResolvedValue({ id: "task1", runCount: 4 });
    mockPrisma.scheduledTask.findUniqueOrThrow.mockResolvedValue({
      id: "task1",
			lastResult: "Manual retry dispatched command request cmd1; awaiting final result",
    });

    const result = await service.retryScheduledTask("task1");

    expect(mockCreateCommandRequest).toHaveBeenCalledWith({
      title: "Scheduled task retry: Clean logs",
      command: "df -h",
      reason: "maintenance",
      submissionMode: "user",
      requesterId: "u1",
      serverIds: ["srv1"],
      teamId: null,
    });
    expect(mockPrisma.scheduledTask.update).toHaveBeenCalledWith({
      where: { id: "task1" },
      data: expect.objectContaining({
				lastResult: "Manual retry dispatched command request cmd1; awaiting final result",
				runCount: { increment: 1 },
      }),
    });
		expect(mockPrisma.scheduledTaskRun.create).toHaveBeenCalledWith({
			data: {
				scheduledTaskId: "task1",
				commandRequestId: "cmd1",
				manual: true,
				dispatchedAt: expect.any(Date),
			},
		});
		expect(result).toEqual({ id: "task1", lastResult: "Manual retry dispatched command request cmd1; awaiting final result" });
  });

  it("reconciles a completed command into the latest task result", async () => {
    const dispatchedAt = new Date("2026-08-04T01:00:00.000Z");
    mockPrisma.scheduledTaskRun.findMany.mockResolvedValue([{
      id: "run1",
      scheduledTaskId: "task1",
      commandRequestId: "cmd1",
      dispatchedAt,
      commandRequest: { status: "COMPLETED" },
      scheduledTask: { name: "Clean logs", createdById: "u1", teamId: "team_a" },
    }]);
    mockPrisma.scheduledTaskRun.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.scheduledTask.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.reconcileScheduledTaskRuns()).resolves.toEqual({
      inspected: 1,
      reconciled: 1,
    });

    expect(mockPrisma.scheduledTaskRun.updateMany).toHaveBeenCalledWith({
      where: { id: "run1", status: "DISPATCHED" },
      data: {
        status: "COMPLETED",
        result: "Completed command request cmd1",
        completedAt: expect.any(Date),
      },
    });
    expect(mockPrisma.scheduledTask.updateMany).toHaveBeenCalledWith({
      where: {
        id: "task1",
        OR: [{ lastRunAt: null }, { lastRunAt: { lte: dispatchedAt } }],
      },
      data: { lastResult: "Completed command request cmd1" },
    });
  });

  it("notifies only when the immediately previous dispatched run also failed", async () => {
    const dispatchedAt = new Date("2026-08-04T02:00:00.000Z");
    mockPrisma.scheduledTaskRun.findMany.mockResolvedValue([{
      id: "run2",
      scheduledTaskId: "task1",
      commandRequestId: "cmd2",
      dispatchedAt,
      commandRequest: { status: "FAILED" },
      scheduledTask: { name: "Clean logs", createdById: "u1", teamId: "team_a" },
    }]);
    mockPrisma.scheduledTaskRun.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.scheduledTask.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.scheduledTaskRun.findFirst.mockResolvedValue({ status: "REJECTED" });
    mockNotifyTaskConsecutiveFailed.mockResolvedValue(undefined);

    await service.reconcileScheduledTaskRuns();

    expect(mockPrisma.scheduledTaskRun.findFirst).toHaveBeenCalledWith({
      where: {
        scheduledTaskId: "task1",
        dispatchedAt: { lt: dispatchedAt },
        completedAt: { not: null },
      },
      orderBy: { dispatchedAt: "desc" },
      select: { status: true },
    });
    expect(mockNotifyTaskConsecutiveFailed).toHaveBeenCalledWith(
      "u1",
      "Clean logs",
      2,
      expect.stringContaining("FAILED"),
      "team_a",
    );
  });

  it("toggles ACTIVE to PAUSED and clears nextRunAt under team scope", async () => {
    mockPrisma.scheduledTask.findFirst.mockResolvedValue({
      id: "task1",
      status: "ACTIVE",
      cronExpression: "0 2 * * *",
    });
    mockPrisma.scheduledTask.update.mockResolvedValue({ id: "task1", status: "PAUSED" });

    await service.toggleScheduledTask("task1", teamSession);

    expect(mockTeamWhere).toHaveBeenCalledWith(teamSession);
    expect(mockPrisma.scheduledTask.update).toHaveBeenCalledWith({
      where: { id: "task1" },
      data: { status: "PAUSED", nextRunAt: null },
    });
  });

  it("rejects serverIds outside team scope on create", async () => {
    mockPrisma.server.findMany.mockResolvedValueOnce([{ id: "srv1" }]); // missing srv_other
    await expect(
      service.createScheduledTask(
        {
          name: "Clean logs",
          cronExpression: "0 2 * * *",
          command: "df -h",
          serverIds: ["srv1", "srv_other"],
          createdById: "u1",
        },
        teamSession,
      ),
    ).rejects.toThrow(/outside your team scope/);
    expect(mockPrisma.scheduledTask.create).not.toHaveBeenCalled();
  });

  it("rejects serverIds outside team scope on update", async () => {
    mockPrisma.scheduledTask.findFirst.mockResolvedValue({ id: "task1", teamId: "team_a" });
    mockPrisma.server.findMany.mockResolvedValueOnce([]); // none in scope
    await expect(
      service.updateScheduledTask(
        "task1",
        { serverIds: ["foreign-srv"] },
        teamSession,
      ),
    ).rejects.toThrow(/outside your team scope/);
    expect(mockPrisma.scheduledTask.update).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleKey } from "@/lib/auth/rbac";
import type { SessionScope } from "../service";

const { mockPrisma, mockCreateCommandRequest, mockTeamWhere, mockTeamCreateData } = vi.hoisted(() => ({
  mockPrisma: {
    scheduledTask: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
  mockCreateCommandRequest: vi.fn(),
  mockTeamWhere: vi.fn(),
  mockTeamCreateData: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/command/service", () => ({ createCommandRequest: mockCreateCommandRequest }));
vi.mock("@/lib/auth/team-scope", () => ({
  teamWhere: mockTeamWhere,
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
      name: "Clean logs",
      cronExpression: "0 2 * * *",
      runCount: 3,
      createdById: "u1",
      lastResult: null,
    });
    mockCreateCommandRequest.mockResolvedValue({ id: "cmd1" });
    mockPrisma.scheduledTask.update.mockResolvedValue({ id: "task1", runCount: 4 });
    mockPrisma.scheduledTask.findUniqueOrThrow.mockResolvedValue({
      id: "task1",
      lastResult: "Manual retry has triggered command request cmd1",
    });

    const result = await service.retryScheduledTask("task1");

    expect(mockCreateCommandRequest).toHaveBeenCalledWith({
      title: "Scheduled task retry: Clean logs",
      command: "df -h",
      reason: "maintenance",
      submissionMode: "user",
      requesterId: "u1",
      serverIds: ["srv1"],
    });
    expect(mockPrisma.scheduledTask.update).toHaveBeenCalledWith({
      where: { id: "task1" },
      data: expect.objectContaining({
        lastResult: "Manual retry has triggered command request cmd1",
        runCount: 4,
      }),
    });
    expect(result).toEqual({ id: "task1", lastResult: "Manual retry has triggered command request cmd1" });
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
});

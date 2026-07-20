import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    playbookFindMany: vi.fn(),
    playbookFindUnique: vi.fn(),
    playbookFindFirst: vi.fn(),
    playbookCreate: vi.fn(),
    playbookUpdate: vi.fn(),
    playbookDelete: vi.fn(),
    runFindMany: vi.fn(),
    runCreate: vi.fn(),
    runUpdate: vi.fn(),
    jobCreate: vi.fn(),
    transaction: vi.fn(),
    auditUserAction: vi.fn(),
    serverFindMany: vi.fn(),
    teamMemberFindUnique: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    playbook: {
      findMany: mocks.playbookFindMany,
      findUnique: mocks.playbookFindUnique,
      findFirst: mocks.playbookFindFirst,
      create: mocks.playbookCreate,
      update: mocks.playbookUpdate,
      delete: mocks.playbookDelete,
    },
    playbookRun: { findMany: mocks.runFindMany },
    server: { findMany: mocks.serverFindMany },
    teamMember: { findUnique: mocks.teamMemberFindUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

import { createPlaybook, deletePlaybook, getPlaybook, listPlaybookRuns, listPlaybooks, runPlaybook, updatePlaybook } from "../service";

const date = new Date("2026-01-01T00:00:00Z");
const baseRow = {
  id: "pb1",
  name: "Cleanup",
  description: null,
  triggerType: "cron",
  triggerConfig: { expression: "0 3 * * *" },
  steps: [{ id: "s1", name: "run", type: "run_command", config: { command: "ls", serverIds: ["srv1"] }, retry: 0, timeoutSec: 60 }],
  chainRetry: 2,
  enabled: true,
  createdById: "u1",
  teamId: "team1",
  createdAt: date,
  updatedAt: date,
};
const queuedRun = {
  id: "run-1",
  playbookId: "pb1",
  status: "queued",
  dryRun: false,
  triggerContext: null,
  stepResults: [],
  errorMessage: null,
  startedAt: null,
  completedAt: null,
  createdById: "u1",
  teamId: "team1",
  createdAt: date,
  updatedAt: date,
};

describe("playbook service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auditUserAction.mockResolvedValue(undefined);
    // Default: all referenced servers exist and are in scope.
    mocks.serverFindMany.mockImplementation(async ({ where }: { where?: { id?: { in?: string[] } } }) => {
      const ids = where?.id?.in ?? [];
      return ids.map((id) => ({ id }));
    });
    mocks.teamMemberFindUnique.mockResolvedValue(null);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      playbookRun: { create: mocks.runCreate, update: mocks.runUpdate },
      job: { create: mocks.jobCreate },
    }));
  });

  it("lists and narrows playbooks", async () => {
    mocks.playbookFindMany.mockResolvedValue([baseRow]);
    const result = await listPlaybooks();
    expect(result[0]?.steps[0]?.type).toBe("run_command");
  });

  it("gets a single playbook or null", async () => {
    mocks.playbookFindUnique.mockResolvedValueOnce(baseRow).mockResolvedValueOnce(null);
    expect((await getPlaybook("pb1"))?.id).toBe("pb1");
    expect(await getPlaybook("missing")).toBeNull();
  });

  it("scopes getPlaybook by team when session is provided", async () => {
    mocks.playbookFindFirst.mockResolvedValueOnce(baseRow).mockResolvedValueOnce(null);
    const session = { userId: "u1", roles: ["operator"] as import("@/lib/auth/rbac").RoleKey[], currentTeamId: "team1" };
    expect((await getPlaybook("pb1", session))?.id).toBe("pb1");
    expect(mocks.playbookFindFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "pb1" }),
    });
    expect(await getPlaybook("other-team-pb", session)).toBeNull();
  });

  it("creates, updates and deletes with audit and stamps teamId on create", async () => {
    mocks.playbookCreate.mockResolvedValue(baseRow);
    mocks.playbookFindFirst.mockResolvedValue(baseRow);
    mocks.playbookUpdate.mockResolvedValue({ ...baseRow, name: "Renamed" });
    const session = { userId: "u1", roles: ["operator"] as import("@/lib/auth/rbac").RoleKey[], currentTeamId: "team1" };
    await createPlaybook({
      name: "Cleanup", triggerType: "cron", triggerConfig: { expression: "0 3 * * *" },
      steps: baseRow.steps as never, chainRetry: 2, enabled: true,
    }, "u1", session);
    expect(mocks.playbookCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ teamId: "team1", createdById: "u1" }),
    });
    expect(mocks.serverFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["srv1"] },
          OR: [{ teamId: "team1" }, { teamId: null }],
        }),
      }),
    );
    await updatePlaybook({ id: "pb1", name: "Renamed" }, "u1", session);
    await deletePlaybook("pb1", "u1", session);
    expect(mocks.playbookDelete).toHaveBeenCalledWith({ where: { id: "pb1" } });
    expect(mocks.auditUserAction).toHaveBeenCalledTimes(3);
  });

  it("rejects create when run_command targets servers outside team scope", async () => {
    mocks.serverFindMany.mockResolvedValueOnce([{ id: "srv1" }]); // missing srv-other
    const session = { userId: "u1", roles: ["operator"] as import("@/lib/auth/rbac").RoleKey[], currentTeamId: "team1" };
    await expect(
      createPlaybook(
        {
          name: "Cross-team shell",
          triggerType: "cron",
          triggerConfig: { expression: "0 3 * * *" },
          steps: [
            {
              id: "s1",
              name: "run",
              type: "run_command",
              config: { command: "id", serverIds: ["srv1", "srv-other"] },
              retry: 0,
              timeoutSec: 60,
            },
          ] as never,
          chainRetry: 0,
          enabled: true,
        },
        "u1",
        session,
      ),
    ).rejects.toThrow(/outside your team scope/i);
    expect(mocks.playbookCreate).not.toHaveBeenCalled();
  });

  it("rejects create when send_notification recipient is outside team scope", async () => {
    mocks.teamMemberFindUnique.mockResolvedValueOnce(null);
    const session = { userId: "u1", roles: ["operator"] as import("@/lib/auth/rbac").RoleKey[], currentTeamId: "team1" };
    await expect(
      createPlaybook(
        {
          name: "Cross-team notify",
          triggerType: "cron",
          triggerConfig: { expression: "0 3 * * *" },
          steps: [
            {
              id: "s1",
              name: "notify",
              type: "send_notification",
              config: { recipientUserId: "u-other-team", subject: "hi", body: "spam" },
              retry: 0,
              timeoutSec: 60,
            },
          ] as never,
          chainRetry: 0,
          enabled: true,
        },
        "u1",
        session,
      ),
    ).rejects.toThrow(/notification recipients were not found or are outside your team scope/i);
    expect(mocks.playbookCreate).not.toHaveBeenCalled();
    expect(mocks.teamMemberFindUnique).toHaveBeenCalledWith({
      where: { teamId_userId: { teamId: "team1", userId: "u-other-team" } },
      select: { userId: true },
    });
  });

  it("allows create when send_notification recipient is self without teamMember lookup", async () => {
    mocks.playbookCreate.mockResolvedValue({
      ...baseRow,
      steps: [
        {
          id: "s1",
          name: "notify",
          type: "send_notification",
          config: { recipientUserId: "u1", subject: "hi", body: "ok" },
          retry: 0,
          timeoutSec: 60,
        },
      ],
    });
    const session = { userId: "u1", roles: ["operator"] as import("@/lib/auth/rbac").RoleKey[], currentTeamId: "team1" };
    await createPlaybook(
      {
        name: "Self notify",
        triggerType: "cron",
        triggerConfig: { expression: "0 3 * * *" },
        steps: [
          {
            id: "s1",
            name: "notify",
            type: "send_notification",
            config: { recipientUserId: "u1", subject: "hi", body: "ok" },
            retry: 0,
            timeoutSec: 60,
          },
        ] as never,
        chainRetry: 0,
        enabled: true,
      },
      "u1",
      session,
    );
    expect(mocks.playbookCreate).toHaveBeenCalled();
    expect(mocks.teamMemberFindUnique).not.toHaveBeenCalled();
  });

  it("rejects update when new steps target out-of-scope servers", async () => {
    mocks.playbookFindFirst.mockResolvedValue(baseRow);
    mocks.serverFindMany.mockResolvedValueOnce([]); // no servers visible
    const session = { userId: "u1", roles: ["operator"] as import("@/lib/auth/rbac").RoleKey[], currentTeamId: "team1" };
    await expect(
      updatePlaybook(
        {
          id: "pb1",
          steps: [
            {
              id: "s1",
              name: "run",
              type: "run_command",
              config: { command: "id", serverIds: ["srv-other-team"] },
              retry: 0,
              timeoutSec: 60,
            },
          ] as never,
        },
        "u1",
        session,
      ),
    ).rejects.toThrow(/outside your team scope/i);
    expect(mocks.playbookUpdate).not.toHaveBeenCalled();
  });

  it("rejects update when new send_notification recipient is outside team scope", async () => {
    mocks.playbookFindFirst.mockResolvedValue(baseRow);
    mocks.teamMemberFindUnique.mockResolvedValueOnce(null);
    const session = { userId: "u1", roles: ["operator"] as import("@/lib/auth/rbac").RoleKey[], currentTeamId: "team1" };
    await expect(
      updatePlaybook(
        {
          id: "pb1",
          steps: [
            {
              id: "s1",
              name: "notify",
              type: "send_notification",
              config: { recipientUserId: "u-foreign", subject: "x", body: "y" },
              retry: 0,
              timeoutSec: 60,
            },
          ] as never,
        },
        "u1",
        session,
      ),
    ).rejects.toThrow(/notification recipients were not found or are outside your team scope/i);
    expect(mocks.playbookUpdate).not.toHaveBeenCalled();
  });

  it("rejects update/delete outside team scope", async () => {
    mocks.playbookFindFirst.mockResolvedValue(null);
    const session = { userId: "u1", roles: ["operator"] as import("@/lib/auth/rbac").RoleKey[], currentTeamId: "team1" };
    await expect(updatePlaybook({ id: "pb-other", name: "x" }, "u1", session)).rejects.toThrow(/不存在|not found/i);
    await expect(deletePlaybook("pb-other", "u1", session)).rejects.toThrow(/不存在|not found/i);
    expect(mocks.playbookUpdate).not.toHaveBeenCalled();
    expect(mocks.playbookDelete).not.toHaveBeenCalled();
  });

  it("scopes run history and limits it to 50", async () => {
    mocks.playbookFindFirst.mockResolvedValue(baseRow);
    mocks.runFindMany.mockResolvedValue([]);
    const session = { userId: "u1", roles: ["operator"] as import("@/lib/auth/rbac").RoleKey[], currentTeamId: "team1" };
    await listPlaybookRuns("pb1", session);
    expect(mocks.runFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ playbookId: "pb1" }),
      take: 50,
    }));
  });

  it("rejects run history for out-of-scope playbooks", async () => {
    mocks.playbookFindFirst.mockResolvedValue(null);
    const session = { userId: "u1", roles: ["operator"] as import("@/lib/auth/rbac").RoleKey[], currentTeamId: "team1" };
    await expect(listPlaybookRuns("pb-other", session)).rejects.toThrow(/不存在|not found/i);
    expect(mocks.runFindMany).not.toHaveBeenCalled();
  });

  it("rejects missing and disabled playbooks", async () => {
    mocks.playbookFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...baseRow, enabled: false });
    await expect(runPlaybook({ playbookId: "missing", dryRun: true })).rejects.toThrow(/不存在|not found/);
    await expect(runPlaybook({ playbookId: "pb1", dryRun: false })).rejects.toThrow(/disabled/);
  });

  it("atomically persists a queued run and durable parent job", async () => {
    mocks.playbookFindFirst.mockResolvedValue(baseRow);
    mocks.runCreate.mockResolvedValue(queuedRun);
    mocks.runUpdate.mockResolvedValue({ ...queuedRun, jobId: "job-1" });
    mocks.jobCreate.mockResolvedValue({ id: "job-1" });
    const session = { userId: "u1", roles: ["operator"] as import("@/lib/auth/rbac").RoleKey[], currentTeamId: "team1" };
    const run = await runPlaybook({ playbookId: "pb1", dryRun: false, createdById: "u1", session });
    expect(run.status).toBe("queued");
    expect(mocks.runCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "queued", teamId: "team1" }) });
    expect(mocks.jobCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      type: "playbook.run", payload: { runId: "run-1" }, maxAttempts: 3, teamId: "team1",
    }) });
    expect(mocks.auditUserAction).toHaveBeenCalledWith("u1", "playbook.run", expect.objectContaining({ runId: "run-1", status: "queued" }));
  });
});

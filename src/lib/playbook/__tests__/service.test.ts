import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    playbookFindMany: vi.fn(),
    playbookFindUnique: vi.fn(),
    playbookFindFirst: vi.fn(),
    alertRuleFindFirst: vi.fn(),
    playbookCreate: vi.fn(),
    playbookUpdate: vi.fn(),
    playbookUpdateMany: vi.fn(),
    playbookDelete: vi.fn(),
    playbookDeleteMany: vi.fn(),
    runFindMany: vi.fn(),
    runFindFirst: vi.fn(),
    runCreate: vi.fn(),
    runUpdate: vi.fn(),
    jobCreate: vi.fn(),
    jobEventCreate: vi.fn(),
    transaction: vi.fn(),
    executeRaw: vi.fn(async () => 0),
    auditUserAction: vi.fn(),
    serverFindMany: vi.fn(),
    serverFindFirst: vi.fn(),
    queryRaw: vi.fn(),
    teamMemberFindUnique: vi.fn(),
    userFindUnique: vi.fn(),
    acquireAdvisoryLock: vi.fn(),
    releaseAdvisoryLock: vi.fn(),
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
      updateMany: mocks.playbookUpdateMany,
      delete: mocks.playbookDelete,
      deleteMany: mocks.playbookDeleteMany,
    },
    playbookRun: { findMany: mocks.runFindMany, findFirst: mocks.runFindFirst },
    alertRule: { findFirst: mocks.alertRuleFindFirst },
    server: { findMany: mocks.serverFindMany },
    teamMember: { findUnique: mocks.teamMemberFindUnique },
    user: { findUnique: mocks.userFindUnique },
    $transaction: mocks.transaction,
    $queryRaw: mocks.queryRaw,
  },
}));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));
vi.mock("@/lib/concurrency/advisory-lock", () => ({ acquireAdvisoryLock: mocks.acquireAdvisoryLock }));

import { createPlaybook, deletePlaybook, getPlaybook, getPlaybookRun, listPlaybookRuns, listRecentPlaybookRunsForPlaybooks, listPlaybooks, runPlaybook, updatePlaybook } from "../service";

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
    mocks.runFindFirst.mockResolvedValue(null);
    mocks.playbookUpdateMany.mockResolvedValue({ count: 1 });
    mocks.playbookDeleteMany.mockResolvedValue({ count: 1 });
    // Default: all referenced servers exist and are in scope.
    mocks.serverFindMany.mockImplementation(async ({ where }: { where?: { id?: { in?: string[] } } }) => {
      const ids = where?.id?.in ?? [];
      return ids.map((id) => ({ id }));
    });
    mocks.teamMemberFindUnique.mockResolvedValue(null);
    mocks.acquireAdvisoryLock.mockResolvedValue(mocks.releaseAdvisoryLock);
    mocks.releaseAdvisoryLock.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      playbook: { deleteMany: mocks.playbookDeleteMany, findFirst: mocks.playbookFindFirst, updateMany: mocks.playbookUpdateMany },
      alertRule: { findFirst: mocks.alertRuleFindFirst },
      playbookRun: { create: mocks.runCreate, update: mocks.runUpdate },
      server: { findFirst: mocks.serverFindFirst },
      job: { create: mocks.jobCreate },
      jobEvent: { create: mocks.jobEventCreate },
      $executeRaw: mocks.executeRaw,
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
    mocks.playbookFindUnique.mockResolvedValue({ ...baseRow, name: "Renamed" });
    mocks.playbookUpdateMany.mockResolvedValue({ count: 1 });
    mocks.playbookDeleteMany.mockResolvedValue({ count: 1 });
    const session = { userId: "u1", roles: ["operator"] as import("@/lib/auth/rbac").RoleKey[], currentTeamId: "team1" };
    await createPlaybook({
      name: "Cleanup", triggerType: "cron", triggerConfig: { expression: "0 3 * * *" },
      steps: baseRow.steps as never, chainRetry: 2, enabled: true,
    }, "u1", session);
    expect(mocks.playbookCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        teamId: "team1",
        createdById: "u1",
        nextRunAt: expect.any(Date),
      }),
    });
    expect(mocks.serverFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["srv1"] },
          AND: expect.arrayContaining([{ teamId: "team1" }]),
        }),
      }),
    );
    await updatePlaybook({ id: "pb1", name: "Renamed" }, "u1", session);
    await deletePlaybook("pb1", "u1", session);
    expect(mocks.acquireAdvisoryLock).toHaveBeenCalledWith("playbook-lifecycle", "pb1");
    expect(mocks.releaseAdvisoryLock).toHaveBeenCalled();
    expect(mocks.playbookDeleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "pb1" }),
    });
    expect(mocks.auditUserAction).toHaveBeenCalledTimes(3);
  });

  it("rejects a partial trigger-type update that would leave an incompatible trigger config", async () => {
    mocks.playbookFindFirst.mockResolvedValue(baseRow);
    const session = { userId: "u1", roles: ["operator"] as import("@/lib/auth/rbac").RoleKey[], currentTeamId: "team1" };

    await expect(
      updatePlaybook({ id: "pb1", triggerType: "metric" }, "u1", session),
    ).rejects.toThrow(/metric trigger requires/i);
    expect(mocks.playbookUpdate).not.toHaveBeenCalled();
  });

  it("needs playbook:run, and command:execute for command steps, to change when a playbook runs", async () => {
    mocks.playbookFindFirst.mockResolvedValue(baseRow);
    type Session = { userId: string; roles: import("@/lib/auth/rbac").RoleKey[]; currentTeamId: string; permissions: import("@/lib/auth/rbac").Permission[] };
    const manageOnly: Session = { userId: "u9", roles: ["operator"], currentTeamId: "team1", permissions: ["playbook:read", "playbook:manage"] };
    for (const change of [{ enabled: false }, { triggerType: "cron" as const, triggerConfig: { expression: "* * * * *" } }, { chainRetry: 5 }]) {
      await expect(updatePlaybook({ id: "pb1", ...change }, "u9", manageOnly)).rejects.toMatchObject({ name: "ForbiddenError" });
    }
    const runWithoutExecute: Session = { ...manageOnly, permissions: ["playbook:read", "playbook:manage", "playbook:run"] };
    await expect(updatePlaybook({ id: "pb1", enabled: false }, "u9", runWithoutExecute)).rejects.toMatchObject({ name: "ForbiddenError" });
    expect(mocks.playbookUpdateMany).not.toHaveBeenCalled();
    await expect(updatePlaybook({ id: "pb1", name: "Renamed" }, "u9", manageOnly)).rejects.toMatchObject({ name: "ForbiddenError", status: 403 });
    mocks.playbookFindFirst.mockResolvedValue({ ...baseRow, enabled: false });
    await updatePlaybook({ id: "pb1", name: "Renamed" }, "u9", manageOnly);
    expect(mocks.playbookUpdateMany).toHaveBeenCalledTimes(1);
  });

  describe("editing the steps of an existing automation", () => {
    const manageOnly = { userId: "u9", currentTeamId: "team1", roles: ["operator" as const], permissions: ["playbook:manage" as const] };
    const hook = {
      id: "s1", name: "Notify hook", type: "call_webhook" as const, config: { method: "POST" as const, url: "https://example.com/hook" }, retry: 0, timeoutSec: 30,
    };
    const steps = [hook];

    it.each(["cron", "metric", "manual"])("requires playbook:run when the stored %s playbook runs automatically", async (triggerType) => {
      mocks.playbookFindFirst.mockResolvedValue({ ...baseRow, triggerType });
      mocks.alertRuleFindFirst.mockResolvedValue({ id: "rule1" });
      await expect(updatePlaybook({ id: "pb1", steps }, "u9", manageOnly)).rejects.toMatchObject({ name: "ForbiddenError", status: 403 });
      if (triggerType === "manual") {
        expect(mocks.alertRuleFindFirst).toHaveBeenCalledWith({ where: { playbookIds: { has: "pb1" } }, select: { id: true } });
      }
      expect(mocks.playbookUpdateMany).not.toHaveBeenCalled();
    });

    it("allows a manager to edit a purely manual or disabled playbook", async () => {
      mocks.alertRuleFindFirst.mockResolvedValue(null);
      for (const state of [{ triggerType: "manual", enabled: true }, { triggerType: "cron", enabled: false }]) {
        mocks.playbookFindFirst.mockResolvedValue({ ...baseRow, ...state });
        await updatePlaybook({ id: "pb1", steps }, "u9", manageOnly);
      }
      expect(mocks.playbookUpdateMany).toHaveBeenCalledTimes(2);
    });

    it.each(["enabled cron", "new alert binding"])("rechecks %s inside the non-runner's write transaction", async (concurrentChange) => {
      mocks.playbookFindFirst.mockResolvedValue({ ...baseRow, enabled: false, triggerType: "manual" });
      const findCurrent = vi.fn().mockResolvedValue({
        id: "pb1", enabled: true, triggerType: concurrentChange === "enabled cron" ? "cron" : "manual",
      });
      const findBinding = vi.fn().mockResolvedValue({ id: "rule1" });
      const write = vi.fn();
      mocks.transaction.mockImplementationOnce(async (apply) => apply({
        playbook: { findFirst: findCurrent, updateMany: write }, alertRule: { findFirst: findBinding },
      }));
      await expect(updatePlaybook({ id: "pb1", steps }, "u9", manageOnly)).rejects.toMatchObject({ name: "ForbiddenError", status: 403 });
      expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
      expect(findCurrent).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "pb1", teamId: "team1" } }));
      if (concurrentChange === "new alert binding") expect(findBinding).toHaveBeenCalledWith({ where: { playbookIds: { has: "pb1" } }, select: { id: true } });
      expect(write).not.toHaveBeenCalled();
      expect(mocks.playbookUpdateMany).not.toHaveBeenCalled();
    });

    it("allows a runner to change webhook steps and still requires command:execute for command steps", async () => {
      const runner = { ...manageOnly, permissions: ["playbook:manage" as const, "playbook:run" as const] };
      mocks.playbookFindFirst.mockResolvedValue(baseRow);
      await updatePlaybook({ id: "pb1", steps }, "u9", runner);
      await expect(updatePlaybook({ id: "pb1", steps: [{
        ...hook, type: "run_command", config: { command: "uptime", serverIds: ["srv1"] },
      }] }, "u9", runner)).rejects.toMatchObject({ name: "ForbiddenError", status: 403, message: expect.stringContaining("command:execute") });
      expect(mocks.playbookUpdateMany).toHaveBeenCalledTimes(1);
    });
  });

  it("lets a non-administrator take over a playbook only once its owner is deactivated", async () => {
    mocks.playbookFindFirst.mockResolvedValue(baseRow);
    mocks.playbookFindUnique.mockResolvedValue(baseRow);
    const member = { userId: "u9", roles: ["operator"] as import("@/lib/auth/rbac").RoleKey[], currentTeamId: "team1" };
    mocks.userFindUnique.mockResolvedValueOnce({ status: "ACTIVE" });
    await expect(updatePlaybook({ id: "pb1", claimOwnership: true }, "u9", member)).rejects.toMatchObject({ name: "ForbiddenError" });
    expect(mocks.playbookUpdateMany).not.toHaveBeenCalled();
    mocks.userFindUnique.mockResolvedValueOnce({ status: "DISABLED" });
    await updatePlaybook({ id: "pb1", claimOwnership: true }, "u9", member);
    expect(mocks.playbookUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ createdById: "u9" }) }));
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
    ).rejects.toThrow(/outside your customer scope/i);
    expect(mocks.playbookCreate).not.toHaveBeenCalled();
  });

  it("rejects create with run_command steps when author lacks command:execute", async () => {
    // Explicit permissions: has playbook:manage but NOT command:execute — the
    // exact permission-decoupling bypass. sessionHasPermission trusts an
    // explicit permissions array, so this simulates a custom role.
    const session = {
      userId: "u1",
      roles: [] as import("@/lib/auth/rbac").RoleKey[],
      currentTeamId: "team1",
      permissions: ["playbook:manage", "playbook:run"] as import("@/lib/auth/rbac").Permission[],
    };
    await expect(
      createPlaybook(
        {
          name: "Sneaky shell",
          triggerType: "cron",
          triggerConfig: { expression: "0 3 * * *" },
          steps: [
            {
              id: "s1",
              name: "run",
              type: "run_command",
              config: { command: "id", serverIds: ["srv1"] },
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
    ).rejects.toThrow(/command:execute/i);
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
    ).rejects.toThrow(/notification recipients were not found or are outside your customer scope/i);
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
    ).rejects.toThrow(/outside your customer scope/i);
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
    ).rejects.toThrow(/notification recipients were not found or are outside your customer scope/i);
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
    await expect(runPlaybook({ playbookId: "pb1", dryRun: false })).rejects.toThrow(/disabled|已禁用/);
  });

  it.each(["other-team", null])("rejects a customer's alert before queueing a playbook owned by %s", async (teamId) => {
    mocks.playbookFindFirst.mockResolvedValue({ ...baseRow, teamId });
    await expect(runPlaybook({ playbookId: "pb1", dryRun: false, sourceAlertTeamId: "team1" })).rejects.toThrow(/不存在|not found/);
    expect(mocks.runCreate).not.toHaveBeenCalled();
    expect(mocks.jobCreate).not.toHaveBeenCalled();
  });

  it.each(["team1", null])("queues a same-host-customer playbook from rule team %s", async (sourceAlertTeamId) => {
    mocks.serverFindFirst.mockResolvedValue({ id: "srv1" });
    mocks.playbookFindFirst.mockResolvedValue(baseRow);
    mocks.runCreate.mockResolvedValue(queuedRun);
    mocks.runUpdate.mockResolvedValue({ ...queuedRun, jobId: "job-1" });
    mocks.jobCreate.mockResolvedValue({ id: "job-1" });
    mocks.jobEventCreate.mockResolvedValue({ id: "event-1" });

    await expect(runPlaybook({
      playbookId: "pb1", dryRun: false, sourceAlertTeamId, sourceAlertServerId: "srv1",
      triggerContext: { type: "alert_rule", serverId: "srv1" },
    })).resolves.toMatchObject({ status: "queued" });
    expect(mocks.serverFindFirst).toHaveBeenCalledWith({ where: { id: "srv1", teamId: "team1" }, select: { id: true } });
    expect(mocks.jobCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ teamId: "team1" }) });
  });

  it.each(["alert_rule", "capacity_forecast"])("rejects platform %s data from another customer's host at enqueue", async (type) => {
    mocks.playbookFindFirst.mockResolvedValue(baseRow);
    mocks.serverFindFirst.mockResolvedValue(null);
    const run = { playbookId: "pb1", dryRun: false, sourceAlertTeamId: null,
      triggerContext: { type, serverId: "foreign", value: 97 } };
    for (const sourceAlertServerId of ["foreign", "substitute", undefined]) {
      await expect(runPlaybook({ ...run, sourceAlertServerId })).rejects.toMatchObject({ name: "NotFoundError" });
    }
    expect(mocks.serverFindFirst).toHaveBeenCalledExactlyOnceWith({ where: { id: "foreign", teamId: "team1" }, select: { id: true } });
    expect(mocks.runCreate).not.toHaveBeenCalled();
  });

  it("uses the reader's current host grants on old and new alert, capacity and metric history", async () => {
    const session = { userId: "u1", roles: ["operator" as const], currentTeamId: "team1" };
    const contexts = [
      { type: "alert_rule", serverId: "moved", serverName: "old host", value: 97 },
      { type: "capacity_forecast", serverId: "denied", serverName: "restricted host", value: 7 },
      { type: "metric", readings: [{ serverId: "allowed", value: 12 }, { serverId: "denied", value: 98 }] },
      { type: "alert_rule", serverId: "allowed", serverName: "visible host", value: 33 },
    ];
    const rows = contexts.map((triggerContext, index) => ({ ...queuedRun, id: String(index), triggerContext }));
    mocks.playbookFindFirst.mockResolvedValue(baseRow);
    mocks.runFindMany.mockResolvedValue(rows);
    mocks.queryRaw.mockResolvedValue(rows);
    mocks.runFindFirst.mockResolvedValue(rows[0]);
    mocks.serverFindMany.mockResolvedValue([{ id: "allowed" }]);
    const expected = [null, null, { type: "metric", readings: [{ serverId: "allowed", value: 12 }] }, contexts[3]];
    expect((await listPlaybookRuns("pb1", session)).map((run) => run.triggerContext)).toEqual(expected);
    expect(mocks.serverFindMany).toHaveBeenCalledExactlyOnceWith({
      where: expect.objectContaining({
        id: { in: ["moved", "denied", "allowed"] },
        AND: [{ teamId: "team1" }, { OR: [{ userAccess: { none: { userId: "u1" } } }, { userAccess: { some: { userId: "u1", canRead: true } } }] }],
      }), select: { id: true },
    });
    expect((await listRecentPlaybookRunsForPlaybooks(["pb1"], session)).pb1?.map((r) => r.triggerContext)).toEqual(expected);
    expect((await getPlaybookRun("0", session))?.triggerContext).toBeNull();
    expect((await listPlaybookRuns("pb1", { ...session, permissions: ["playbook:read"] })).map((r) => r.triggerContext))
      .toEqual([null, null, { type: "metric", readings: [] }, null]);
  });

  it("only exposes recognized host details from malformed historical trigger contexts", async () => {
    const session = { userId: "u1", roles: ["operator" as const], currentTeamId: "team1" };
    mocks.playbookFindFirst.mockResolvedValue(baseRow);
    mocks.serverFindMany.mockResolvedValue([{ id: "allowed" }]);
    const contexts = [
      "private-host", ["private-host"], { type: "metric", readings: { "private-host": 98 }, other: "private-host" },
      { type: "metric", readings: [null, { serverId: "allowed", value: 10, extra: { serverName: "private-host" } }] },
      { type: "unknown", serverName: "private-host" },
    ];
    mocks.runFindMany.mockResolvedValue(contexts.map((triggerContext) => ({ ...queuedRun, triggerContext })));
    const runs = await listPlaybookRuns("pb1", session);
    expect(runs.map((r) => r.triggerContext)).toEqual([
      null, null, { type: "metric", readings: [] }, { type: "metric", readings: [{ serverId: "allowed", value: 10 }] }, null,
    ]);
  });

  it("redacts receipts and parent errors on every history read, including rows without a step snapshot", async () => {
    const session = { userId: "u1", roles: ["operator" as const], currentTeamId: "team1" };
    const url = "https://example.org/private-token?key=secret";
    const hook = { id: "s1", type: "call_webhook", config: { url, method: "POST" } };
    const failed = { stepId: "s1", status: "failed", httpStatus: 403, error: url, summary: url, responseBody: url };
    const row = { ...queuedRun, errorMessage: url, stepResults: [failed], executionState: { schemaVersion: 1, stepsSnapshot: [hook] } };
    const legacy = { ...row, executionState: null, stepResults: [
      null, 19, { status: url }, { ...failed, stepId: "missing", completedAt: url },
    ] };
    mocks.playbookFindFirst.mockResolvedValue(baseRow); // definition has since changed to a command
    mocks.runFindMany.mockResolvedValue([row, legacy]);
    mocks.runFindFirst.mockResolvedValue(row);
    mocks.queryRaw.mockResolvedValue([row, legacy]);
    const history = await listPlaybookRuns("pb1", session);
    expect(history[0]).toMatchObject({ errorMessage: "webhook step s1 POST example.org: HTTP 403", stepResults: [{
      stepId: "s1", status: "failed", error: "webhook step s1 POST example.org: HTTP 403", summary: "",
    }] });
    expect(history[1]).toMatchObject({ errorMessage: "failed", stepResults: [{ error: "failed" }] });
    for (const result of [history, await getPlaybookRun(row.id, session), await listRecentPlaybookRunsForPlaybooks(["pb1"], session)]) {
      expect(JSON.stringify(result)).not.toMatch(/private-token|key=secret|responseBody/);
    }
  });

  it("atomically persists a queued run and durable parent job", async () => {
    mocks.playbookFindFirst.mockResolvedValue(baseRow);
    mocks.runCreate.mockResolvedValue(queuedRun);
    mocks.runUpdate.mockResolvedValue({ ...queuedRun, jobId: "job-1" });
    mocks.jobCreate.mockResolvedValue({ id: "job-1" });
    mocks.jobEventCreate.mockResolvedValue({ id: "event-1" });
    const session = { userId: "u1", roles: ["operator"] as import("@/lib/auth/rbac").RoleKey[], currentTeamId: "team1" };
    const run = await runPlaybook({ playbookId: "pb1", dryRun: false, createdById: "u1", session });
    expect(run.status).toBe("queued");
    expect(mocks.runCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "queued", teamId: "team1" }) });
    expect(mocks.jobCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      type: "playbook.run", payload: { runId: "run-1" }, maxAttempts: 3, teamId: "team1",
    }) });
    expect(mocks.jobEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobId: "job-1",
        type: "enqueued",
      }),
    });
    // The run's workspace must reach the audit row: an unstamped row is
    // teamId: null, which teamWhere shows to every tenant.
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "playbook.run",
      expect.objectContaining({ runId: "run-1", status: "queued" }),
      undefined,
      "team1",
    );
  });

  it("does not give a legacy playbook with an excessive chainRetry extra job attempts", async () => {
    mocks.playbookFindFirst.mockResolvedValue({ ...baseRow, chainRetry: 100_000 });
    mocks.runCreate.mockResolvedValue(queuedRun);
    mocks.runUpdate.mockResolvedValue({ ...queuedRun, jobId: "job-1" });
    mocks.jobCreate.mockResolvedValue({ id: "job-1" });
    mocks.jobEventCreate.mockResolvedValue({ id: "event-1" });

    await runPlaybook({ playbookId: "pb1", dryRun: false });

    expect(mocks.jobCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ maxAttempts: 1 }) });
  });

  it("quarantines a null-team playbook instead of exposing it to every tenant", async () => {
    // `playbookTeamWhere` is strict: a `teamId: null` playbook replays frozen
    // server ids that the caller may not own, and `runPlaybook` does not
    // re-check the steps, so it must not be readable/runnable by an arbitrary
    // tenant the way the loose `teamWhere` (`OR: [team, null]`) allowed.
    mocks.playbookFindFirst.mockResolvedValue(null);
    const tenant = { userId: "u1", roles: ["operator"] as import("@/lib/auth/rbac").RoleKey[], currentTeamId: "team1" };
    expect(await getPlaybook("legacy-pb", tenant)).toBeNull();
    expect(mocks.playbookFindFirst).toHaveBeenCalledWith({
      where: { id: "legacy-pb", teamId: "team1" },
    });

    // A session with no current team gets the unmatchable sentinel rather than
    // every unassigned playbook.
    mocks.playbookFindMany.mockResolvedValueOnce([]);
    const teamless = { userId: "u2", roles: ["operator"] as import("@/lib/auth/rbac").RoleKey[], currentTeamId: null };
    expect(await listPlaybooks(teamless)).toEqual([]);
    expect(mocks.playbookFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: "__unassigned_playbooks_require_team_manage__" },
      }),
    );

    await expect(runPlaybook({ playbookId: "legacy-pb", dryRun: false, session: tenant })).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("lets a team:manage admin still reach an unassigned playbook", async () => {
    // The quarantine has to leave someone able to reassign the row.
    mocks.playbookFindFirst.mockResolvedValueOnce({ ...baseRow, teamId: null });
    const admin = { userId: "admin", roles: ["admin"] as import("@/lib/auth/rbac").RoleKey[], currentTeamId: null };
    expect((await getPlaybook("pb1", admin))?.id).toBe("pb1");
    expect(mocks.playbookFindFirst).toHaveBeenCalledWith({ where: { id: "pb1" } });
  });

  it("blocks delete when a run is queued or running", async () => {
    const session = { userId: "u1", roles: ["operator"] as import("@/lib/auth/rbac").RoleKey[], currentTeamId: "team1" };
    mocks.playbookFindFirst.mockResolvedValueOnce(baseRow);
    mocks.runFindFirst.mockResolvedValueOnce({ id: "run-active" });
    await expect(deletePlaybook("pb1", "u1", session)).rejects.toThrow(/进行中|running|Cannot delete/i);
    expect(mocks.playbookDelete).not.toHaveBeenCalled();
  });


});

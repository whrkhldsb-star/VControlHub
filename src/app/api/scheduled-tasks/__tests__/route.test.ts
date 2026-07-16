import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    createScheduledTask: vi.fn(),
    listScheduledTasks: vi.fn(),
    updateScheduledTask: vi.fn(),
    deleteScheduledTask: vi.fn(),
    describeCron: vi.fn(),
    retryScheduledTask: vi.fn(),
    toggleScheduledTask: vi.fn(),
    auditUserAction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/scheduled-task/service", () => ({
  createScheduledTask: mocks.createScheduledTask,
  listScheduledTasks: mocks.listScheduledTasks,
  updateScheduledTask: mocks.updateScheduledTask,
  deleteScheduledTask: mocks.deleteScheduledTask,
  describeCron: mocks.describeCron,
  retryScheduledTask: mocks.retryScheduledTask,
  toggleScheduledTask: mocks.toggleScheduledTask,
}));
vi.mock("@/lib/audit/service", () => ({
  auditUserAction: mocks.auditUserAction,
}));

const route = await import("../route");
const session = { userId: "u1", username: "alice", user: { id: "u1" } };

describe("/api/scheduled-tasks audit coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session });
    mocks.listScheduledTasks.mockResolvedValue([]);
    mocks.describeCron.mockReturnValue("每天 2:00");
    mocks.createScheduledTask.mockResolvedValue({
      id: "task1",
      name: "Clean logs",
      cronExpression: "0 2 * * *",
      command: "journalctl --vacuum-time=7d && cat /etc/shadow",
      reason: "maintenance",
      serverIds: ["srv1", "srv2"],
      status: "ACTIVE",
    });
    mocks.updateScheduledTask.mockResolvedValue({
      id: "task1",
      name: "Clean logs weekly",
      cronExpression: "0 2 * * 1",
      command: "journalctl --vacuum-time=7d && cat /etc/shadow",
      reason: "weekly maintenance",
      serverIds: ["srv1"],
      status: "ACTIVE",
    });
    mocks.toggleScheduledTask.mockResolvedValue({
      id: "task1",
      name: "Clean logs",
      cronExpression: "0 2 * * *",
      command: "journalctl --vacuum-time=7d && cat /etc/shadow",
      reason: "maintenance",
      serverIds: ["srv1", "srv2"],
      status: "PAUSED",
    });
    mocks.retryScheduledTask.mockResolvedValue({
      id: "task1",
      name: "Clean logs",
      cronExpression: "0 2 * * *",
      command: "journalctl --vacuum-time=7d && cat /etc/shadow",
      reason: "maintenance",
      serverIds: ["srv1", "srv2"],
      status: "ACTIVE",
    });
    mocks.deleteScheduledTask.mockResolvedValue({
      id: "task1",
      name: "Clean logs",
      cronExpression: "0 2 * * *",
      command: "journalctl --vacuum-time=7d && cat /etc/shadow",
      reason: "maintenance",
      serverIds: ["srv1", "srv2"],
      status: "ACTIVE",
    });
  });

  it("serializes cron descriptions for refreshed scheduled task lists", async () => {
    mocks.listScheduledTasks.mockResolvedValue([
      {
        id: "task1",
        name: "Clean logs",
        cronExpression: "0 2 * * *",
        command: "journalctl --vacuum-time=7d",
        reason: "maintenance",
        serverIds: ["srv1"],
        status: "ACTIVE",
        lastRunAt: new Date("2026-01-01T00:00:00Z"),
        nextRunAt: new Date("2026-01-02T02:00:00Z"),
        lastResult: "执行失败：disk full",
        runCount: 2,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        creator: { username: "alice", displayName: null },
      },
    ]);

    const res = await route.GET(new Request("http://local/api/scheduled-tasks"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.tasks[0]).toMatchObject({
      id: "task1",
      cronDescription: "每天 2:00",
      lastResult: "执行失败：disk full",
    });
  });

  it("allows read-only command users to refresh scheduled task lists", async () => {
    await route.GET(new Request("http://local/api/scheduled-tasks"));

    expect(mocks.requireApiPermission).toHaveBeenCalledWith("command:read");
    expect(mocks.listScheduledTasks).toHaveBeenCalledWith(200, session);
  });

  it("accepts create payloads from the current client without legacy cron/serverId fields", async () => {
    const res = await route.POST(
      new Request("http://local/api/scheduled-tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Clean logs",
          cronExpression: "0 2 * * *",
          command: "journalctl --vacuum-time=7d",
          serverIds: ["srv1", "srv2"],
          reason: "maintenance",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.createScheduledTask).toHaveBeenCalledWith(
      {
        name: "Clean logs",
        cronExpression: "0 2 * * *",
        command: "journalctl --vacuum-time=7d",
        reason: "maintenance",
        serverIds: ["srv1", "srv2"],
        createdById: "u1",
      },
      session,
    );
  });

  it("maps update aliases to scheduled task service fields", async () => {
    const res = await route.PATCH(
      new Request("http://local/api/scheduled-tasks", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "task1",
          cron: "0 2 * * 1",
          description: "weekly maintenance",
          serverId: "srv1",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.updateScheduledTask).toHaveBeenCalledWith(
      "task1",
      {
        name: undefined,
        cronExpression: "0 2 * * 1",
        command: undefined,
        reason: "weekly maintenance",
        serverIds: ["srv1"],
        status: undefined,
      },
      session,
    );
  });

  it("retries scheduled tasks from the API and audits without leaking command text", async () => {
    const res = await route.PATCH(
      new Request("http://local/api/scheduled-tasks", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ retryId: "task1" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.retryScheduledTask).toHaveBeenCalledWith("task1", session);
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "scheduled_task.retry",
      expect.objectContaining({ taskId: "task1", name: "Clean logs" }),
    );
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain("journalctl");
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain("/etc/shadow");
  });

  it("audits scheduled task lifecycle changes without leaking command text", async () => {
    await route.POST(
      new Request("http://local/api/scheduled-tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Clean logs",
          cronExpression: "0 2 * * *",
          cron: "0 2 * * *",
          command: "journalctl --vacuum-time=7d && cat /etc/shadow",
          serverId: "srv1",
          serverIds: ["srv1", "srv2"],
          reason: "maintenance",
        }),
      }),
    );

    await route.PATCH(
      new Request("http://local/api/scheduled-tasks", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "task1",
          name: "Clean logs weekly",
          cron: "0 2 * * 1",
        }),
      }),
    );

    await route.PATCH(
      new Request("http://local/api/scheduled-tasks", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "task1", toggleId: "task1" }),
      }),
    );

    await route.DELETE(
      new Request("http://local/api/scheduled-tasks?id=task1", {
        method: "DELETE",
      }),
    );

    expect(mocks.requireApiPermission).toHaveBeenCalledWith("command:create");
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "scheduled_task.create",
      expect.objectContaining({
        taskId: "task1",
        name: "Clean logs",
        cronExpression: "0 2 * * *",
        serverCount: 2,
        status: "ACTIVE",
      }),
    );
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "scheduled_task.update",
      expect.objectContaining({
        taskId: "task1",
        name: "Clean logs weekly",
        cronExpression: "0 2 * * 1",
        serverCount: 1,
        status: "ACTIVE",
      }),
    );
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "scheduled_task.toggle",
      expect.objectContaining({ taskId: "task1", status: "PAUSED" }),
    );
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "scheduled_task.delete",
      expect.objectContaining({ taskId: "task1", name: "Clean logs" }),
      "WARNING",
    );
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain(
      "journalctl",
    );
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain(
      "/etc/shadow",
    );
  });
});

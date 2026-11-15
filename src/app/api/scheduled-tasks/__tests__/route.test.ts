import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    createScheduledTask: vi.fn(),
    listScheduledTasks: vi.fn(),
    updateScheduledTask: vi.fn(),
    deleteScheduledTask: vi.fn(),
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
  retryScheduledTask: mocks.retryScheduledTask,
  toggleScheduledTask: mocks.toggleScheduledTask,
}));
vi.mock("@/lib/audit/service", () => ({
  auditUserAction: mocks.auditUserAction,
}));
// The handlers read the caller's language from the locale cookie (getServerLocale).
const localeCookie = vi.hoisted(() => ({ value: "zh" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "vps-locale" ? { value: localeCookie.value } : undefined) }),
}));

const route = await import("../route");
const session = { userId: "u1", username: "alice", user: { id: "u1" }, currentTeamId: null };

describe("/api/scheduled-tasks audit coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localeCookie.value = "zh";
    mocks.requireApiPermission.mockResolvedValue({ session });
    mocks.listScheduledTasks.mockResolvedValue([]);
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

    const res = await route.GET(new Request("http://local/api/scheduled-tasks", { headers: { cookie: "vps-locale=zh" } }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.tasks[0]).toMatchObject({
      id: "task1",
      cronDescription: "每天 2:00 执行",
      lastResult: "执行失败：disk full",
    });
  });

  // The scheduler stores its result in English ("Completed command request …") or in the language of the
  // moment; the list says it in the reader's language.
  it("says a stored last result in the reader's language", async () => {
    mocks.listScheduledTasks.mockResolvedValue([
      { id: "task1", name: "Clean logs", cronExpression: "0 2 * * *", command: "true", reason: "", serverIds: ["srv1"], status: "ACTIVE", lastRunAt: null, nextRunAt: null, lastResult: "Completed command request cmd_9", runCount: 1, createdAt: new Date("2026-01-01T00:00:00Z"), creator: null },
      { id: "task2", name: "Rotate", cronExpression: "0 3 * * *", command: "true", reason: "", serverIds: ["srv1"], status: "ACTIVE", lastRunAt: null, nextRunAt: null, lastResult: "已派发命令请求 cmd_8，等待最终结果", runCount: 1, createdAt: new Date("2026-01-01T00:00:00Z"), creator: null },
    ]);

    const zh = await (await route.GET(new Request("http://local/api/scheduled-tasks", { headers: { cookie: "vps-locale=zh" } }))).json();
    expect(zh.tasks.map((task: { lastResult: string }) => task.lastResult)).toEqual(["命令请求 cmd_9 已完成", "已派发命令请求 cmd_8，等待最终结果"]);
    const en = await (await route.GET(new Request("http://local/api/scheduled-tasks", { headers: { cookie: "vps-locale=en" } }))).json();
    expect(en.tasks.map((task: { lastResult: string }) => task.lastResult)).toEqual(["Command request cmd_9 completed", "Dispatched command request cmd_8; awaiting the final result"]);
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

  it("refuses at once what every later run would be refused for (name, command and reason limits of the command request)", async () => {
    const base = { name: "Clean logs", cronExpression: "0 2 * * *", command: "uptime", serverIds: ["srv1"] };
    const post = (body: Record<string, unknown>) => route.POST(new Request("http://local/api/scheduled-tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    for (const bad of [{ name: "n".repeat(101) }, { command: "c".repeat(10_001) }, { reason: "r".repeat(501) }]) {
      expect((await post({ ...base, ...bad })).status).toBe(400);
    }
    expect(mocks.createScheduledTask).not.toHaveBeenCalled();
    const patch = (body: Record<string, unknown>) => route.PATCH(new Request("http://local/api/scheduled-tasks", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "t1", ...body }),
    }));
    for (const bad of [{ name: "" }, { command: "" }, { name: "n".repeat(101) }]) {
      expect((await patch(bad)).status).toBe(400);
    }
    expect(mocks.updateScheduledTask).not.toHaveBeenCalled();
  });

  it("says what a create request is missing in the caller's language, and names the right field", async () => {
    // These were refinements of the schema with fixed Chinese text: an English session read
    // "cronExpression: 请填写 Cron 表达式", and so did a one-time task that lacked its run time.
    localeCookie.value = "en";
    const post = async (body: Record<string, unknown>) => {
      const res = await route.POST(new Request("http://local/api/scheduled-tasks", {
        method: "POST",
        // One cookie, as a browser sends it: the header and the cookie store cannot disagree.
        headers: { "content-type": "application/json", cookie: `vps-locale=${localeCookie.value}` },
        body: JSON.stringify(body),
      }));
      return { status: res.status, message: ((await res.json()) as { message: string }).message };
    };
    const base = { name: "Clean logs", command: "uptime" };
    expect(await post({ ...base, serverIds: ["srv1"] })).toEqual({ status: 400, message: "Cron expression is required" });
    expect(await post({ ...base, scheduleType: "ONCE", serverIds: ["srv1"] })).toEqual({ status: 400, message: "One-time execution must use a future date and time" });
    expect(await post({ ...base, cronExpression: "0 2 * * *", serverIds: [] })).toEqual({ status: 400, message: "At least one target server is required" });
    expect(mocks.createScheduledTask).not.toHaveBeenCalled();

    localeCookie.value = "zh";
    expect((await post({ ...base, serverIds: ["srv1"] })).message).toBe("请填写 Cron 表达式");

    // The older single-server field still names the target when the list is empty.
    expect((await post({ ...base, cronExpression: "0 2 * * *", serverIds: [], serverId: "srv9" })).status).toBe(200);
    expect(mocks.createScheduledTask).toHaveBeenCalledWith(expect.objectContaining({ serverIds: ["srv9"] }), session);
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
      undefined, null);
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
      undefined, null);
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
      undefined, null);
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "scheduled_task.toggle",
      expect.objectContaining({ taskId: "task1", status: "PAUSED" }),
      undefined, null);
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "scheduled_task.delete",
      expect.objectContaining({ taskId: "task1", name: "Clean logs" }),
      "WARNING",
      null,
    );
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain(
      "journalctl",
    );
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain(
      "/etc/shadow",
    );
  });
});

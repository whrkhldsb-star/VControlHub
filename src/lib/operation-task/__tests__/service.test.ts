import { describe, expect, it, vi, beforeEach } from "vitest";
import { serverTeamWhere } from "@/lib/auth/team-scope";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $queryRaw: vi.fn(),
    storageNode: { findMany: vi.fn() },
    executionLog: { findMany: vi.fn() },
    job: { findMany: vi.fn() },
    commandRequest: { findMany: vi.fn() },
    commandTarget: { findMany: vi.fn() },
    scheduledTask: { findMany: vi.fn() },
    downloadTask: { findMany: vi.fn() },
    syncJob: { findMany: vi.fn() },
    backupRecord: { findMany: vi.fn() },
    deploymentRun: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/storage/access-control", () => ({ assertStorageAccess: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/runtime-settings/service", () => ({
  getOperationTaskListLimit: vi.fn(async () => 100),
}));

const { listOperationTaskResult, mapOperationStatus } = await import("../service");

// A team manager: `teamWhere` collapses to `{}` for this role, which is the same
// unfiltered `where` the old session-less overload produced — so the existing
// where-shape assertions below still describe the same queries.
const MANAGER = { userId: "admin-1", roles: ["admin"] as const, currentTeamId: "team-1" };
type ListOptions = Parameters<typeof listOperationTaskResult>[0];
const listTasks = async (options: ListOptions = {}) =>
  (await listOperationTaskResult(options, { ...MANAGER, roles: [...MANAGER.roles] })).tasks;
const { getOperationTaskListLimit } = await import("@/lib/runtime-settings/service");

describe("operation task service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOperationTaskListLimit).mockResolvedValue(100);
    mockPrisma.job.findMany.mockResolvedValue([
      {
        id: "job1",
        title: "Background backup task",
        status: "RUNNING",
        createdAt: new Date("2026-01-03T00:00:00Z"),
        updatedAt: new Date("2026-01-03T00:00:00Z"),
        progress: "25%",
        errorMessage: null,
        workerId: "worker-job",
        workerHeartbeatAt: new Date("2026-01-03T00:01:00Z"),
        creator: { username: "ops", displayName: null },
      },
    ]);
    mockPrisma.commandRequest.findMany.mockResolvedValue([
      {
        id: "cmd1",
        title: "Restart service",
        status: "PENDING_APPROVAL",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        workerId: null,
        workerHeartbeatAt: null,
        requester: { username: "alice", displayName: null },
        targets: [],
        executionLogs: [],
      },
    ]);
    mockPrisma.scheduledTask.findMany.mockResolvedValue([]);
    mockPrisma.downloadTask.findMany.mockResolvedValue([
      { id: "dl1", targetPath: "/drive/files", server: { storageNode: { id: "node", basePath: "/drive" } }, url: "https://example.com/a.iso", status: "RUNNING", createdAt: new Date("2026-01-02T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"), fileName: "a.iso", progress: "50%", creator: null },
    ]);
    mockPrisma.syncJob.findMany.mockResolvedValue([]);
    mockPrisma.backupRecord.findMany.mockResolvedValue([]);
    mockPrisma.deploymentRun.findMany.mockResolvedValue([]);
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.commandTarget.findMany.mockResolvedValue([]);
  });

  it("aggregates durable jobs with existing command/download/sync/scheduled jobs into a unified recent task list", async () => {
    const tasks = await listTasks({ limit: 10 });

    expect(tasks.map((task) => task.id)).toEqual(["job:job1", "download:dl1", "command:cmd1"]);
    expect(tasks[0]).toMatchObject({ source: "job", status: "running", progress: "25%", workerId: "worker-job" });
    expect(tasks[1]).toMatchObject({ source: "download", status: "running", progress: "50%" });
    expect(tasks[2]).toMatchObject({ source: "command", status: "pending", workerId: null, workerHeartbeatAt: null });
  });

  it("lists a schedule's runs under its name instead of the schedule definition", async () => {
    mockPrisma.commandRequest.findMany.mockResolvedValue([
      {
        id: "cmd-run",
        title: "Scheduled task: Nightly backup",
        status: "RUNNING",
        createdAt: new Date("2026-01-04T00:00:00Z"),
        updatedAt: new Date("2026-01-04T00:00:00Z"),
        workerId: "worker-1",
        workerHeartbeatAt: null,
        requester: { username: "ops", displayName: null },
        teamId: "current",
        targets: [
          { id: "first", server: { name: "node A", teamId: "current" }, executionChannel: "AGENT", status: "COMPLETED", outcomeUnknown: false, finishedAt: new Date("2026-01-04T00:00:00Z") },
          { id: "second", server: { name: "renamed", teamId: "moved" }, executionChannel: "SSH", fallbackReason: "AGENT_UNCLAIMED", status: "FAILED", outcomeUnknown: true },
        ],
        executionLogs: [{ serverId: "moved-server", summary: "transferred server details" }, { serverId: null, summary: "Request started" }],
        scheduledTaskRuns: [{ scheduledTask: { name: "Nightly backup" } }],
      },
    ]);

    const { tasks } = await listOperationTaskResult({ limit: 10 }, { ...MANAGER, roles: ["admin"], currentTeamId: null });
    const run = tasks.find((task) => task.sourceId === "cmd-run");

    expect(run).toMatchObject({ id: "scheduled:cmd-run", source: "scheduled", title: "Nightly backup", status: "running", href: "/scheduled-tasks" });
    expect(run?.targetEvidence).toMatchObject([
      { label: "node A", executionChannel: "AGENT", succeededAt: "2026-01-04T00:00:00.000Z" },
    ]);
    expect(mockPrisma.$queryRaw.mock.calls[0]?.[0].values).toContainEqual(["first"]);
    expect(mockPrisma.commandTarget.findMany.mock.calls[0]?.[0].where.OR).toEqual([
      { commandRequestId: "cmd-run", serverId: { in: ["moved-server"] }, server: { teamId: "current" } },
    ]);
    expect(run?.logPreview).toContain("Request started");
    expect(run?.logPreview).not.toContain("transferred server details");
    expect(tasks.some((task) => task.source === "command" && task.sourceId === "cmd-run")).toBe(false);
  });

  it("does not report a sync job that never ran as completed", async () => {
    mockPrisma.syncJob.findMany.mockResolvedValue([
      { id: "sync-new", name: "Mirror photos", status: "IDLE", lastSyncAt: null, lastSyncResult: null, createdAt: new Date("2026-01-05T00:00:00Z"), updatedAt: new Date("2026-01-05T00:00:00Z"), creator: null },
      { id: "sync-done", name: "Mirror docs", status: "IDLE", lastSyncAt: new Date("2026-01-05T01:00:00Z"), lastSyncResult: "ok", createdAt: new Date("2026-01-05T00:00:00Z"), updatedAt: new Date("2026-01-05T01:00:00Z"), creator: null },
    ]);

    const tasks = await listTasks({ limit: 10 });

    expect(tasks.find((task) => task.sourceId === "sync-new")?.status).toBe("pending");
    expect(tasks.find((task) => task.sourceId === "sync-done")?.status).toBe("completed");
  });

  it("uses the runtime setting as the default and maximum list limit", async () => {
    vi.mocked(getOperationTaskListLimit).mockResolvedValue(42);

    await listTasks();

    expect(mockPrisma.commandRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 42 }));
    // Schedule definitions are not tasks; their runs arrive as commands.
    expect(mockPrisma.scheduledTask.findMany).not.toHaveBeenCalled();

    await listTasks({ limit: 500 });
    expect(mockPrisma.commandRequest.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 42 }));
  });

  it("limits ordinary task readers to their own records inside the active team", async () => {
    await listOperationTaskResult(
      { limit: 10 },
      { userId: "user-1", roles: ["viewer"], currentTeamId: "team-1" },
    );

    const teamScope = { teamId: "team-1" };
    const server = serverTeamWhere({ userId: "user-1", roles: ["viewer"], currentTeamId: "team-1" });
    expect(mockPrisma.job.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [teamScope, { createdBy: "user-1" }] } }));
    expect(mockPrisma.commandRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [teamScope, { requesterId: "user-1" }] } }));
    expect(mockPrisma.downloadTask.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [teamScope, { createdBy: "user-1" }], server } }));
    expect(mockPrisma.syncJob.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ AND: [teamScope, { createdBy: "user-1" }] }, expect.objectContaining({ sourceServer: { is: server }, targetServer: { is: server } })] } }));
    expect(mockPrisma.backupRecord.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.deploymentRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [teamScope, { createdBy: "user-1" }] } }));
  });

  it("lets administrators viewing all customers inspect every task", async () => {
    await listOperationTaskResult(
      { limit: 10 },
      { userId: "admin-1", roles: ["admin"], currentTeamId: null },
    );

    expect(mockPrisma.job.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    expect(mockPrisma.commandRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it("scopes target tails and execution logs to the reader's current server grants", async () => {
    const session = { userId: "ops-1", roles: ["operator" as const], currentTeamId: "team-1" };
    const serverScope = serverTeamWhere(session, "read");
    const row = {
      id: "cmd", teamId: "team-1", status: "FAILED", title: "Maintenance", createdAt: new Date(),
      targets: [{ id: "target-visible", server: { name: "Visible", teamId: "team-1" } }],
      executionLogs: [
        { serverId: "revoked", summary: "restricted log" },
        { serverId: "moved", summary: "transferred server details" },
        { serverId: "revoked", summary: "another restricted log" },
      ],
    };
    mockPrisma.commandRequest.findMany.mockResolvedValue([
      row, { ...row, id: "unbound", targets: [], executionLogs: [{ serverId: null, summary: "internal log" }] },
    ]);
    mockPrisma.commandTarget.findMany.mockResolvedValue([{ commandRequestId: "cmd", serverId: "other-visible" }]);
    mockPrisma.executionLog.findMany.mockResolvedValueOnce([{ serverId: "other-visible", summary: "visible log outside target preview" }]);
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: "target-visible", stdout: "visible stdout", stderr: "visible stderr" }]);

    const { tasks } = await listOperationTaskResult({}, session);

    expect(mockPrisma.commandRequest.findMany.mock.calls[0]?.[0].include.targets.where).toEqual({ server: serverScope });
    expect(mockPrisma.commandRequest.findMany.mock.calls[0]?.[0].include.executionLogs.take).toBe(3);
    expect(mockPrisma.commandTarget.findMany.mock.calls[0]?.[0].where).toEqual({
      server: serverScope,
      OR: [{ commandRequestId: "cmd", server: { teamId: "team-1" } }],
    });
    const tailQuery = mockPrisma.$queryRaw.mock.calls[0]?.[0];
    expect(tailQuery.values).toEqual(expect.arrayContaining([["target-visible"], "ops-1", "team-1"]));
    expect(tailQuery.sql).toContain('s."teamId" IS NOT DISTINCT FROM r."teamId"');
    expect(tailQuery.sql).toContain('a."canRead"');
    expect(tasks.find(task => task.sourceId === "cmd")?.logPreview).toEqual(["visible log outside target preview", "visible stdout", "visible stderr"]);
    expect(tasks.find(task => task.sourceId === "unbound")?.logPreview).toEqual([]);
  });

  it("paginates past fully folded job pages for an older ordinary job", async () => {
    const row = { type: "alert.evaluate", status: "COMPLETED", createdAt: new Date(), updatedAt: new Date(), title: "evaluate" };
    mockPrisma.job.findMany.mockResolvedValueOnce([{ ...row, id: "a" }, { ...row, id: "b" }])
      .mockResolvedValueOnce([{ ...row, id: "c" }, { ...row, id: "d", type: "ordinary" }]);
    mockPrisma.commandRequest.findMany.mockResolvedValue([]);
    mockPrisma.downloadTask.findMany.mockResolvedValue([]);
    expect((await listTasks({ limit: 2 })).map(task => [task.sourceId, task.foldedCount])).toEqual([["a", 3], ["d", undefined]]);
    expect(mockPrisma.job.findMany.mock.calls[1]?.[0]).toMatchObject({ cursor: { id: "b" }, skip: 1 });
  });

  it("includes an older failure when attention is limited to pending and failed", async () => {
    const row = { createdAt: new Date(), updatedAt: new Date(), type: "test", title: "work" };
    mockPrisma.job.findMany.mockImplementation(async ({ where }) => where.AND.some((clause: { status?: { in: string[] } }) => clause.status?.in.join() === "FAILED")
      ? [{ ...row, id: "old", status: "FAILED", createdAt: new Date(0) }] : [{ ...row, id: "new", status: "PENDING" }]);
    mockPrisma.commandRequest.findMany.mockResolvedValue([]);
    mockPrisma.downloadTask.findMany.mockResolvedValue([]);
    expect((await listTasks({ sort: "attention", status: ["pending", "failed"], limit: 1 }))[0]?.sourceId).toBe("old");
  });

  it("continues past revoked download directories and excludes sync paths the owner cannot read", async () => {
    const row = { createdAt: new Date(), updatedAt: new Date(), status: "PENDING", url: "https://example.org/file",
      server: { storageNode: { id: "drive", basePath: "/drive" } } };
    const access = vi.mocked((await import("@/lib/storage/access-control")).assertStorageAccess);
    access.mockResolvedValueOnce({ allowed: false });
    mockPrisma.job.findMany.mockResolvedValue([]);
    mockPrisma.commandRequest.findMany.mockResolvedValue([]);
    mockPrisma.downloadTask.findMany.mockResolvedValueOnce([{ ...row, id: "hidden", targetPath: "/drive/hidden" }])
      .mockResolvedValueOnce([{ ...row, id: "visible", targetPath: "/drive/granted" }]);
    mockPrisma.syncJob.findMany.mockResolvedValueOnce([{ ...row, id: "sync", sourceServerId: "s1", sourcePath: "/hidden", targetServerId: "s2", targetPath: "/backup" }]);
    mockPrisma.storageNode.findMany.mockResolvedValueOnce([]);
    const result = await listOperationTaskResult({ limit: 1 }, { userId: "owner", roles: ["viewer"], currentTeamId: "team-1", permissions: ["storage:read"] });
    expect(result.tasks.map(task => task.id)).toEqual(["download:visible"]);
    expect(mockPrisma.downloadTask.findMany.mock.calls[1]?.[0].cursor).toEqual({ id: "hidden" });
  });

  it("folds completed high-frequency alert evaluation jobs without hiding active or failed evaluations", async () => {
    mockPrisma.job.findMany.mockResolvedValue([
      {
        id: "alert_new",
        type: "alert.evaluate",
        title: "Alert rule evaluation",
        status: "COMPLETED",
        createdAt: new Date("2026-01-04T00:00:00Z"),
        updatedAt: new Date("2026-01-04T00:00:00Z"),
        progress: "Evaluated 2 rules",
        errorMessage: null,
        workerId: null,
        workerHeartbeatAt: null,
        creator: null,
      },
      {
        id: "alert_old",
        type: "alert.evaluate",
        title: "Alert rule evaluation",
        status: "COMPLETED",
        createdAt: new Date("2026-01-03T00:00:00Z"),
        updatedAt: new Date("2026-01-03T00:00:00Z"),
        progress: "Evaluated 1 rule",
        errorMessage: null,
        workerId: null,
        workerHeartbeatAt: null,
        creator: null,
      },
      {
        id: "alert_failed",
        type: "alert.evaluate",
        title: "Alert rule evaluation",
        status: "FAILED",
        createdAt: new Date("2026-01-02T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
        progress: null,
        errorMessage: "SMTP failed",
        workerId: null,
        workerHeartbeatAt: null,
        creator: null,
      },
    ]);
    mockPrisma.commandRequest.findMany.mockResolvedValue([]);
    mockPrisma.downloadTask.findMany.mockResolvedValue([]);

    const tasks = await listTasks({ limit: 10 });

    expect(tasks.map((task) => task.id)).toEqual(["job:alert_new", "job:alert_failed"]);
    expect(tasks[0]).toMatchObject({
      taskType: "alert.evaluate",
      status: "completed",
      foldedCount: 2,
      progress: "Evaluated 2 rules",
    });
    expect(tasks[1]).toMatchObject({
      taskType: "alert.evaluate",
      status: "failed",
      progress: "SMTP failed",
    });
    expect(tasks[1]!.foldedCount).toBeUndefined();
  });

  it("filters tasks by status and durable job type after folding noisy completed jobs", async () => {
    mockPrisma.job.findMany.mockResolvedValue([
      {
        id: "alert_completed",
        type: "alert.evaluate",
        title: "Alert rule evaluation",
        status: "COMPLETED",
        createdAt: new Date("2026-01-04T00:00:00Z"),
        updatedAt: new Date("2026-01-04T00:00:00Z"),
        progress: "Evaluated 2 rules",
        errorMessage: null,
        workerId: null,
        workerHeartbeatAt: null,
        creator: null,
      },
      {
        id: "alert_failed",
        type: "alert.evaluate",
        title: "Alert rule evaluation",
        status: "FAILED",
        createdAt: new Date("2026-01-03T00:00:00Z"),
        updatedAt: new Date("2026-01-03T00:00:00Z"),
        progress: null,
        errorMessage: "SMTP failed",
        workerId: null,
        workerHeartbeatAt: null,
        creator: null,
      },
      {
        id: "backup_failed",
        type: "backup.create",
        title: "Create backup",
        status: "FAILED",
        createdAt: new Date("2026-01-02T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
        progress: null,
        errorMessage: "backup failed",
        workerId: null,
        workerHeartbeatAt: null,
        creator: null,
      },
    ]);
    mockPrisma.commandRequest.findMany.mockResolvedValue([]);
    mockPrisma.downloadTask.findMany.mockResolvedValue([]);

    const tasks = await listTasks({ limit: 10, status: "failed", taskType: "alert.evaluate" });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: "job:alert_failed", status: "failed", taskType: "alert.evaluate", progress: "SMTP failed" });
  });

  // A job's progress and failure are sentences its worker stored, mostly in English. The page says them in
  // its own language; the failure groups are still read from what was stored.
  it("says a job's stored progress and failure in the reader's language", async () => {
    const job = (id: string, status: string, progress: string | null, errorMessage: string | null) => ({
      id, type: "download.execute", title: `Direct download ${id}`, status,
      createdAt: new Date("2026-01-02T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"),
      progress, errorMessage, workerId: null, workerHeartbeatAt: null, creator: null,
    });
    mockPrisma.job.findMany.mockResolvedValue([
      job("dl_running", "RUNNING", "Running DATABASE backup", null),
      job("dl_failed", "FAILED", null, "Download task dl_1 is missing a VPS node"),
    ]);
    mockPrisma.commandRequest.findMany.mockResolvedValue([]);
    mockPrisma.downloadTask.findMany.mockResolvedValue([]);

    const result = await listOperationTaskResult({ limit: 10 }, { ...MANAGER, roles: [...MANAGER.roles] });

    expect(result.tasks.find((task) => task.id === "job:dl_running")).toMatchObject({ progress: "正在执行数据库备份", logPreview: ["正在执行数据库备份"] });
    expect(result.tasks.find((task) => task.id === "job:dl_failed")).toMatchObject({ progress: "下载任务 dl_1 没有目标服务器" });
    // "missing" in the stored text: the group of missing resources, as before.
    expect(result.failureSummary.map((item) => item.reason)).toEqual(["文件或资源不存在"]);
  });

  it("summarizes filtered operation tasks by source for triage", async () => {
    mockPrisma.job.findMany.mockResolvedValue([
      {
        id: "job_failed",
        type: "backup.create",
        title: "Create backup",
        status: "FAILED",
        createdAt: new Date("2026-01-04T00:00:00Z"),
        updatedAt: new Date("2026-01-04T00:00:00Z"),
        progress: null,
        errorMessage: "backup failed",
        workerId: null,
        workerHeartbeatAt: null,
        creator: null,
      },
    ]);
    mockPrisma.commandRequest.findMany.mockResolvedValue([
      {
        id: "cmd_pending",
        title: "Restart service",
        status: "PENDING_APPROVAL",
        createdAt: new Date("2026-01-03T00:00:00Z"),
        updatedAt: new Date("2026-01-03T00:00:00Z"),
        workerId: null,
        workerHeartbeatAt: null,
        requester: null,
      },
      {
        id: "cmd_done",
        title: "View logs",
        status: "COMPLETED",
        createdAt: new Date("2026-01-02T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
        workerId: null,
        workerHeartbeatAt: null,
        requester: null,
      },
    ]);
    mockPrisma.downloadTask.findMany.mockResolvedValue([]);

    const result = await listOperationTaskResult({ limit: 10, status: ["failed", "pending", "running"] }, { ...MANAGER, roles: [...MANAGER.roles] });

    expect(result.tasks.map((task) => task.id)).toEqual(["job:job_failed", "command:cmd_pending"]);
    expect(result.sourceSummary).toEqual([
      { source: "command", total: 1, attention: 1, failed: 0, running: 0, pending: 1 },
      { source: "job", total: 1, attention: 1, failed: 1, running: 0, pending: 0 },
    ]);
  });

  it("summarizes failed operation tasks by normalized failure reason", async () => {
    mockPrisma.job.findMany.mockResolvedValue([
      {
        id: "alert_failed",
        type: "alert.evaluate",
        title: "Alert rule evaluation",
        status: "FAILED",
        createdAt: new Date("2026-01-04T00:00:00Z"),
        updatedAt: new Date("2026-01-04T00:00:00Z"),
        progress: null,
        errorMessage: "SMTP failed",
        workerId: null,
        workerHeartbeatAt: null,
        creator: null,
      },
      {
        id: "backup_failed",
        type: "backup.create",
        title: "Create backup",
        status: "FAILED",
        createdAt: new Date("2026-01-03T00:00:00Z"),
        updatedAt: new Date("2026-01-03T00:00:00Z"),
        progress: null,
        errorMessage: "backup failed: no such file",
        workerId: null,
        workerHeartbeatAt: null,
        creator: null,
      },
    ]);
    mockPrisma.commandRequest.findMany.mockResolvedValue([]);
    mockPrisma.downloadTask.findMany.mockResolvedValue([]);

    const result = await listOperationTaskResult({ limit: 10, status: "failed" }, { ...MANAGER, roles: [...MANAGER.roles] });

    expect(result.failureSummary).toEqual([
      { reason: "通知发送失败", total: 1, sources: ["job"], latestTaskId: "job:alert_failed", latestTitle: "Alert rule evaluation", latestAt: "2026-01-04T00:00:00.000Z" },
      { reason: "文件或资源不存在", total: 1, sources: ["job"], latestTaskId: "job:backup_failed", latestTitle: "Create backup", latestAt: "2026-01-03T00:00:00.000Z" },
    ]);
  });

  it("orders attention tasks before completed tasks when requested", async () => {
    mockPrisma.job.findMany.mockResolvedValue([
      {
        id: "completed_new",
        type: "backup.create",
        title: "Latest completed task",
        status: "COMPLETED",
        createdAt: new Date("2026-01-05T00:00:00Z"),
        updatedAt: new Date("2026-01-05T00:00:00Z"),
        progress: null,
        errorMessage: null,
        workerId: null,
        workerHeartbeatAt: null,
        creator: null,
      },
      {
        id: "failed_old",
        type: "backup.create",
        title: "Earlier failed task",
        status: "FAILED",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        progress: null,
        errorMessage: "backup failed",
        workerId: null,
        workerHeartbeatAt: null,
        creator: null,
      },
    ]);
    mockPrisma.commandRequest.findMany.mockResolvedValue([]);
    mockPrisma.downloadTask.findMany.mockResolvedValue([]);

    const tasks = await listTasks({ limit: 10, sort: "attention" });

    expect(tasks.map((task) => task.id)).toEqual(["job:failed_old", "job:completed_new"]);
  });

  it("adds compact log previews from command execution logs and target output", async () => {
    mockPrisma.job.findMany.mockResolvedValue([]);
    mockPrisma.commandRequest.findMany.mockResolvedValue([
      {
        id: "cmd_logs",
        title: "Check service logs",
        status: "FAILED",
        createdAt: new Date("2026-01-04T00:00:00Z"),
        updatedAt: new Date("2026-01-04T00:00:00Z"),
        workerId: "worker-command",
        workerHeartbeatAt: new Date("2026-01-04T00:01:00Z"),
        requester: { username: "ops", displayName: null },
        teamId: "team-1",
        executionLogs: [{ serverId: null, summary: "Execution started" }, { serverId: null, summary: "Target returned error" }],
        targets: [{ id: "tgt_1", status: "FAILED", server: { name: "node", teamId: "team-1" } }],
      },
    ]);
    mockPrisma.downloadTask.findMany.mockResolvedValue([]);
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: "tgt_1", stdout: "line 1\nline 2", stderr: "fatal: service unavailable" },
    ]);

    const tasks = await listTasks({ limit: 10 });

    expect(tasks[0]).toMatchObject({
      id: "command:cmd_logs",
      // Said in the reader's language (the default here: Chinese).
      logPreview: ["line 2", "fatal: service unavailable", expect.stringMatching(/^后台执行器 worker-command · 心跳 /)],
    });
    // The preview must not drag the full output columns out of Postgres.
    const commandQuery = mockPrisma.commandRequest.findMany.mock.calls.at(-1)?.[0] as {
      include?: { targets?: { select?: Record<string, unknown> } };
    };
    expect(commandQuery.include?.targets?.select).not.toHaveProperty("stdout");
    expect(commandQuery.include?.targets?.select).not.toHaveProperty("stderr");
  });

  it("maps active deployment command requests as running operation tasks", async () => {
    mockPrisma.job.findMany.mockResolvedValue([]);
    mockPrisma.commandRequest.findMany.mockResolvedValue([]);
    mockPrisma.downloadTask.findMany.mockResolvedValue([]);
    mockPrisma.deploymentRun.findMany.mockResolvedValue([
      {
        id: "dep_running",
        status: "PENDING",
        createdAt: new Date("2026-01-03T00:00:00Z"),
        updatedAt: new Date("2026-01-03T00:00:00Z"),
        template: { name: "Deploy app" },
        creator: { username: "ops", displayName: null },
        commandRequest: {
          status: "APPROVED",
          workerId: "worker-1",
          workerHeartbeatAt: new Date("2026-01-03T00:01:00Z"),
          updatedAt: new Date("2026-01-03T00:01:00Z"),
        },
      },
    ]);

    const tasks = await listTasks({ limit: 10 });

    expect(tasks).toEqual([
      expect.objectContaining({
        id: "deployment:dep_running",
        source: "deployment",
        title: "Deploy app",
        status: "running",
        actor: "ops",
        progress: "后台执行器 worker-1 · 心跳 2026-01-03T00:01:00.000Z",
        workerId: "worker-1",
        workerHeartbeatAt: "2026-01-03T00:01:00.000Z",
        href: "/deployments?deploymentId=dep_running",
      }),
    ]);
  });

  it("emits exact command deep links, capability flags, and supports q and awaitingApproval filters", async () => {
    mockPrisma.job.findMany.mockResolvedValue([]);
    mockPrisma.downloadTask.findMany.mockResolvedValue([]);
    mockPrisma.commandRequest.findMany.mockResolvedValue([
      {
        id: "cmd_pending_1",
        title: "Restart nginx",
        status: "PENDING_APPROVAL",
        riskLevel: "high",
        origin: "MANUAL",
        requesterId: "user-other",
        createdAt: new Date("2026-01-04T00:00:00Z"),
        updatedAt: new Date("2026-01-04T00:00:00Z"),
        workerId: null,
        workerHeartbeatAt: null,
        requester: { username: "bob", displayName: null },
        targets: [],
        executionLogs: [],
      },
      {
        id: "cmd_running_1",
        title: "Check disk",
        status: "RUNNING",
        riskLevel: "low",
        origin: "MANUAL",
        requesterId: "admin-1",
        createdAt: new Date("2026-01-03T00:00:00Z"),
        updatedAt: new Date("2026-01-03T00:00:00Z"),
        workerId: null,
        workerHeartbeatAt: null,
        requester: { username: "admin", displayName: null },
        targets: [],
        executionLogs: [],
      },
    ]);

    const adminResult = await listOperationTaskResult(
      { limit: 10, awaitingApproval: true, q: "nginx" },
      { ...MANAGER, roles: [...MANAGER.roles] },
    );
    expect(adminResult.tasks).toHaveLength(1);
    expect(adminResult.tasks[0]).toMatchObject({
      id: "command:cmd_pending_1",
      commandRequestId: "cmd_pending_1",
      rawStatus: "PENDING_APPROVAL",
      href: "/requests?requestId=cmd_pending_1",
      canInspectCommand: true,
      canCancelCommand: true,
      canRerunCommand: true,
    });
    // awaitingApproval skips non-approval sources and pushes PENDING_APPROVAL + q into DB where before take (Astra P2-5).
    expect(mockPrisma.job.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.downloadTask.findMany).not.toHaveBeenCalled();
    const cmdWhere = mockPrisma.commandRequest.findMany.mock.calls[0]?.[0]?.where;
    expect(JSON.stringify(cmdWhere)).toContain('"status":"PENDING_APPROVAL"');
    expect(JSON.stringify(cmdWhere)).toContain('"contains":"nginx"');

    // Non-owner without command:approve cannot inspect or rerun someone else's command body.
    const readerResult = await listOperationTaskResult(
      { limit: 10 },
      { userId: "reader-1", roles: ["viewer"], currentTeamId: "team-1", permissions: ["task:read", "command:read", "command:create"] },
    );
    const otherTask = readerResult.tasks.find((t) => t.sourceId === "cmd_pending_1");
    expect(otherTask).toMatchObject({
      canInspectCommand: false,
      canRerunCommand: false,
      canCancelCommand: false,
    });
  });

  it("maps a sync job in ERROR to failed, not pending", () => {
    expect(mapOperationStatus("PRUNING")).toBe("running");
    expect(mapOperationStatus("ERROR")).toBe("failed");
    expect(mapOperationStatus("PENDING_APPROVAL")).toBe("pending");
    expect(mapOperationStatus("SOMETHING_NEW")).toBe("pending");
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    job: { findMany: vi.fn() },
    commandRequest: { findMany: vi.fn() },
    scheduledTask: { findMany: vi.fn() },
    downloadTask: { findMany: vi.fn() },
    syncJob: { findMany: vi.fn() },
    backupRecord: { findMany: vi.fn() },
    deploymentRun: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/runtime-settings/service", () => ({
  getOperationTaskListLimit: vi.fn(async () => 100),
}));

const { listOperationTasks, listOperationTaskResult } = await import("../service");
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
      { id: "dl1", url: "https://example.com/a.iso", status: "RUNNING", createdAt: new Date("2026-01-02T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"), fileName: "a.iso", progress: "50%", creator: null },
    ]);
    mockPrisma.syncJob.findMany.mockResolvedValue([]);
    mockPrisma.backupRecord.findMany.mockResolvedValue([]);
    mockPrisma.deploymentRun.findMany.mockResolvedValue([]);
  });

  it("aggregates durable jobs with existing command/download/sync/scheduled jobs into a unified recent task list", async () => {
    const tasks = await listOperationTasks({ limit: 10 });

    expect(tasks.map((task) => task.id)).toEqual(["job:job1", "download:dl1", "command:cmd1"]);
    expect(tasks[0]).toMatchObject({ source: "job", status: "running", progress: "25%", workerId: "worker-job" });
    expect(tasks[1]).toMatchObject({ source: "download", status: "running", progress: "50%" });
    expect(tasks[2]).toMatchObject({ source: "command", status: "pending", workerId: null, workerHeartbeatAt: null });
  });

  it("uses the runtime setting as the default and maximum list limit", async () => {
    vi.mocked(getOperationTaskListLimit).mockResolvedValue(42);

    await listOperationTasks();

    expect(mockPrisma.commandRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 42 }));
    expect(mockPrisma.scheduledTask.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 42 }));

    await listOperationTasks({ limit: 500 });
    expect(mockPrisma.commandRequest.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 42 }));
  });

  it("limits ordinary task readers to their own records inside the active team", async () => {
    await listOperationTaskResult(
      { limit: 10 },
      { userId: "user-1", roles: ["viewer"], currentTeamId: "team-1" },
    );

    const teamScope = { OR: [{ teamId: "team-1" }, { teamId: null }] };
    expect(mockPrisma.job.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [teamScope, { createdBy: "user-1" }] } }));
    expect(mockPrisma.commandRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [teamScope, { requesterId: "user-1" }] } }));
    expect(mockPrisma.scheduledTask.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [teamScope, { createdById: "user-1" }] } }));
    expect(mockPrisma.downloadTask.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [teamScope, { createdBy: "user-1" }] } }));
    expect(mockPrisma.syncJob.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [teamScope, { createdBy: "user-1" }] } }));
    expect(mockPrisma.backupRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [teamScope, { createdBy: "user-1" }] } }));
    expect(mockPrisma.deploymentRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [teamScope, { createdBy: "user-1" }] } }));
  });

  it("allows team managers to inspect all tasks in the current team scope", async () => {
    await listOperationTaskResult(
      { limit: 10 },
      { userId: "admin-1", roles: ["admin"], currentTeamId: "team-1" },
    );

    expect(mockPrisma.job.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    expect(mockPrisma.commandRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
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

    const tasks = await listOperationTasks({ limit: 10 });

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

    const tasks = await listOperationTasks({ limit: 10, status: "failed", taskType: "alert.evaluate" });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: "job:alert_failed", status: "failed", taskType: "alert.evaluate", progress: "SMTP failed" });
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

    const result = await listOperationTaskResult({ limit: 10, status: ["failed", "pending", "running"] });

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

    const result = await listOperationTaskResult({ limit: 10, status: "failed" });

    expect(result.failureSummary).toEqual([
      { reason: "Notification delivery failed", total: 1, sources: ["job"], latestTaskId: "job:alert_failed", latestTitle: "Alert rule evaluation", latestAt: "2026-01-04T00:00:00.000Z" },
      { reason: "File or resource not found", total: 1, sources: ["job"], latestTaskId: "job:backup_failed", latestTitle: "Create backup", latestAt: "2026-01-03T00:00:00.000Z" },
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

    const tasks = await listOperationTasks({ limit: 10, sort: "attention" });

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
        executionLogs: [{ summary: "Execution started" }, { summary: "Target returned error" }],
        targets: [{ stdout: "line 1\nline 2", stderr: "fatal: service unavailable" }],
      },
    ]);
    mockPrisma.downloadTask.findMany.mockResolvedValue([]);

    const tasks = await listOperationTasks({ limit: 10 });

    expect(tasks[0]).toMatchObject({
      id: "command:cmd_logs",
      logPreview: ["line 2", "fatal: service unavailable", expect.stringMatching(/backend executor worker-command/)],
    });
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

    const tasks = await listOperationTasks({ limit: 10 });

    expect(tasks).toEqual([
      expect.objectContaining({
        id: "deployment:dep_running",
        source: "deployment",
        title: "Deploy app",
        status: "running",
        actor: "ops",
        progress: expect.stringMatching(/backend executor worker-1/),
        workerId: "worker-1",
        workerHeartbeatAt: "2026-01-03T00:01:00.000Z",
        href: "/deployments",
      }),
    ]);
  });
});

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
        title: "后台备份任务",
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
        title: "重启服务",
        status: "PENDING_APPROVAL",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        workerId: null,
        workerHeartbeatAt: null,
        requester: { username: "alice", displayName: null },
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

  it("folds completed high-frequency alert evaluation jobs without hiding active or failed evaluations", async () => {
    mockPrisma.job.findMany.mockResolvedValue([
      {
        id: "alert_new",
        type: "alert.evaluate",
        title: "告警规则评估",
        status: "COMPLETED",
        createdAt: new Date("2026-01-04T00:00:00Z"),
        updatedAt: new Date("2026-01-04T00:00:00Z"),
        progress: "已评估 2 条规则",
        errorMessage: null,
        workerId: null,
        workerHeartbeatAt: null,
        creator: null,
      },
      {
        id: "alert_old",
        type: "alert.evaluate",
        title: "告警规则评估",
        status: "COMPLETED",
        createdAt: new Date("2026-01-03T00:00:00Z"),
        updatedAt: new Date("2026-01-03T00:00:00Z"),
        progress: "已评估 1 条规则",
        errorMessage: null,
        workerId: null,
        workerHeartbeatAt: null,
        creator: null,
      },
      {
        id: "alert_failed",
        type: "alert.evaluate",
        title: "告警规则评估",
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
      progress: "已评估 2 条规则",
    });
    expect(tasks[1]).toMatchObject({
      taskType: "alert.evaluate",
      status: "failed",
      progress: "SMTP failed",
    });
    expect(tasks[1].foldedCount).toBeUndefined();
  });

  it("filters tasks by status and durable job type after folding noisy completed jobs", async () => {
    mockPrisma.job.findMany.mockResolvedValue([
      {
        id: "alert_completed",
        type: "alert.evaluate",
        title: "告警规则评估",
        status: "COMPLETED",
        createdAt: new Date("2026-01-04T00:00:00Z"),
        updatedAt: new Date("2026-01-04T00:00:00Z"),
        progress: "已评估 2 条规则",
        errorMessage: null,
        workerId: null,
        workerHeartbeatAt: null,
        creator: null,
      },
      {
        id: "alert_failed",
        type: "alert.evaluate",
        title: "告警规则评估",
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
        title: "创建备份",
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
        title: "创建备份",
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
        title: "重启服务",
        status: "PENDING_APPROVAL",
        createdAt: new Date("2026-01-03T00:00:00Z"),
        updatedAt: new Date("2026-01-03T00:00:00Z"),
        workerId: null,
        workerHeartbeatAt: null,
        requester: null,
      },
      {
        id: "cmd_done",
        title: "查看日志",
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
        title: "告警规则评估",
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
        title: "创建备份",
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
      { reason: "通知发送失败", total: 1, sources: ["job"], latestTaskId: "job:alert_failed", latestTitle: "告警规则评估", latestAt: "2026-01-04T00:00:00.000Z" },
      { reason: "文件或资源不存在", total: 1, sources: ["job"], latestTaskId: "job:backup_failed", latestTitle: "创建备份", latestAt: "2026-01-03T00:00:00.000Z" },
    ]);
  });

  it("orders attention tasks before completed tasks when requested", async () => {
    mockPrisma.job.findMany.mockResolvedValue([
      {
        id: "completed_new",
        type: "backup.create",
        title: "最新完成任务",
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
        title: "较早失败任务",
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
        progress: expect.stringContaining("后台执行器 worker-1"),
        workerId: "worker-1",
        workerHeartbeatAt: "2026-01-03T00:01:00.000Z",
        href: "/deployments",
      }),
    ]);
  });
});

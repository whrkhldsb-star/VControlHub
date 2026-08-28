import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for pruneOperationTaskHistory — TR-006 跨来源统一长期保留策略
 *
 * 覆盖：
 *   - 5 个来源（command/download/sync/backup/deployment）正确裁剪 completed 状态
 *   - keepLatest 按 teamId 分组生效（一个租户占不满另一个租户的名额）
 *   - olderThan 过滤正确
 *   - 单来源失败不影响其他来源
 *   - 默认 90 天 / 100 条
 */

const { mockPrisma, infoMock, warnMock } = vi.hoisted(() => ({
  mockPrisma: {
    commandRequest: { findMany: vi.fn(), deleteMany: vi.fn(), groupBy: vi.fn() },
    downloadTask: { findMany: vi.fn(), deleteMany: vi.fn(), groupBy: vi.fn() },
    syncJob: { findMany: vi.fn(), deleteMany: vi.fn(), groupBy: vi.fn() },
    backupRecord: { findMany: vi.fn(), deleteMany: vi.fn(), groupBy: vi.fn() },
    deploymentRun: { findMany: vi.fn(), deleteMany: vi.fn(), groupBy: vi.fn() },
  },
  infoMock: vi.fn(),
  warnMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logging", () => ({
  createLogger: () => ({
    info: infoMock,
    warn: warnMock,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { pruneOperationTaskHistory } = await import("../retention");

function setupEmptyMocks() {
  // One legacy null-team scope by default: enough for every source to run its
  // prune exactly once, matching the pre-grouping single-pass expectations.
  mockPrisma.commandRequest.groupBy.mockResolvedValue([{ teamId: null }]);
  mockPrisma.downloadTask.groupBy.mockResolvedValue([{ teamId: null }]);
  mockPrisma.syncJob.groupBy.mockResolvedValue([{ teamId: null }]);
  mockPrisma.backupRecord.groupBy.mockResolvedValue([{ teamId: null }]);
  mockPrisma.deploymentRun.groupBy.mockResolvedValue([{ teamId: null }]);
  mockPrisma.commandRequest.findMany.mockResolvedValue([]);
  mockPrisma.commandRequest.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.downloadTask.findMany.mockResolvedValue([]);
  mockPrisma.downloadTask.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.syncJob.findMany.mockResolvedValue([]);
  mockPrisma.syncJob.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.backupRecord.findMany.mockResolvedValue([]);
  mockPrisma.backupRecord.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.deploymentRun.findMany.mockResolvedValue([]);
  mockPrisma.deploymentRun.deleteMany.mockResolvedValue({ count: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupEmptyMocks();
});

describe("pruneOperationTaskHistory — TR-006 跨来源保留策略", () => {
  it("默认 90 天 / 100 条：传空表 → 5 来源 totalDeleted=0, olderThan 距 now 正好 90d", async () => {
    const now = new Date("2026-06-15T00:00:00Z");
    const result = await pruneOperationTaskHistory({ now });

    expect(result.totalDeleted).toBe(0);
    expect(result.keepLatest).toBe(100);
    // 90 天前
    expect(new Date(result.olderThan).toISOString()).toBe("2026-03-17T00:00:00.000Z");
    // 5 个来源都跑了
    expect(Object.keys(result.perSource).sort()).toEqual(["backup", "command", "deployment", "download", "sync"]);
  });

  it("command: 保留最新 N 条不被删, 早于 olderThan 的全删", async () => {
    const now = new Date("2026-06-15T00:00:00Z");
    mockPrisma.commandRequest.findMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }, { id: "c3" }]);
    mockPrisma.commandRequest.deleteMany.mockResolvedValue({ count: 47 });

    const result = await pruneOperationTaskHistory({ now, keepLatest: 3 });

    expect(result.perSource.command?.scanned).toBe(3);
    expect(result.perSource.command?.deleted).toBe(47);
    expect(result.totalDeleted).toBe(47);

    // findMany 用 status in (COMPLETED/FAILED/REJECTED/CANCELLED) + orderBy createdAt desc + take 3
    expect(mockPrisma.commandRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ["COMPLETED", "FAILED", "REJECTED", "CANCELLED"] }, teamId: null },
        orderBy: [{ createdAt: "desc" }],
        take: 3,
      }),
    );

    // deleteMany: notIn [c1,c2,c3] AND createdAt < 90 天前
    expect(mockPrisma.commandRequest.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["COMPLETED", "FAILED", "REJECTED", "CANCELLED"] },
          createdAt: { lt: new Date("2026-03-17T00:00:00.000Z") },
          id: { notIn: ["c1", "c2", "c3"] },
        }),
      }),
    );
  });

  it("download/deployment 用终态字面量；sync/backup 配置与工件保留策略不再删除", async () => {
    await pruneOperationTaskHistory({ now: new Date("2026-06-15T00:00:00Z") });

    expect(mockPrisma.downloadTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ["COMPLETED", "FAILED", "CANCELLED"] }, teamId: null } }),
    );
    expect(mockPrisma.deploymentRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ["COMPLETED", "FAILED", "CANCELLED", "REJECTED", "ROLLED_BACK"] }, teamId: null },
      }),
    );
    // SyncJob is long-lived config; BackupRecord is owned by backup retention with file unlink.
    expect(mockPrisma.syncJob.groupBy).not.toHaveBeenCalled();
    expect(mockPrisma.syncJob.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.syncJob.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.backupRecord.groupBy).not.toHaveBeenCalled();
    expect(mockPrisma.backupRecord.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.backupRecord.deleteMany).not.toHaveBeenCalled();
  });

  it("command 用 createdAt；sync/backup 跳过不删配置与工件", async () => {
    await pruneOperationTaskHistory({ now: new Date("2026-06-15T00:00:00Z") });

    expect(mockPrisma.commandRequest.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ createdAt: { lt: expect.any(Date) } }),
      }),
    );
    expect(mockPrisma.syncJob.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.backupRecord.deleteMany).not.toHaveBeenCalled();
  });

  it("findMany 返回空 (无任何 completed 记录) → deleteMany notIn 条件不传 (id filter 跳过)", async () => {
    mockPrisma.commandRequest.findMany.mockResolvedValue([]);
    mockPrisma.commandRequest.deleteMany.mockResolvedValue({ count: 0 });

    await pruneOperationTaskHistory({ now: new Date("2026-06-15T00:00:00Z") });

    // deleteMany where 里不应该有 id: { notIn: [] } (空数组会让 Prisma 抛错)
    const call = mockPrisma.commandRequest.deleteMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(call.where.id).toBeUndefined();
  });

  it("单来源 throw → 不影响其他来源, perSource.command.error 被记录, warnMock 触发", async () => {
    mockPrisma.commandRequest.findMany.mockRejectedValue(new Error("DB down"));
    mockPrisma.downloadTask.findMany.mockResolvedValue([{ id: "d1" }]);
    mockPrisma.downloadTask.deleteMany.mockResolvedValue({ count: 5 });
    mockPrisma.downloadTask.deleteMany.mockResolvedValue({ count: 5 });

    const result = await pruneOperationTaskHistory({ now: new Date("2026-06-15T00:00:00Z") });

    expect(result.perSource.command?.error).toBe("DB down");
    expect(result.perSource.command?.deleted).toBe(0);
    expect(result.perSource.download?.deleted).toBe(5);
    expect(result.totalDeleted).toBe(5);
    expect(warnMock).toHaveBeenCalledWith("pruneOperationTaskHistory: command failed", { error: "DB down" });
  });

  it("keepLatest=0 (无效值) → 兜底 1, scan/delete 仍跑", async () => {
    mockPrisma.commandRequest.findMany.mockResolvedValue([{ id: "c1" }]);
    mockPrisma.commandRequest.deleteMany.mockResolvedValue({ count: 0 });

    const result = await pruneOperationTaskHistory({ keepLatest: 0 });

    expect(result.keepLatest).toBe(1);
    expect(mockPrisma.commandRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }));
  });

  it("totalDeleted > 0 → logger.info 调一次 (汇总日志)", async () => {
    mockPrisma.commandRequest.findMany.mockResolvedValue([{ id: "c1" }]);
    mockPrisma.commandRequest.deleteMany.mockResolvedValue({ count: 10 });

    const result = await pruneOperationTaskHistory({ now: new Date("2026-06-15T00:00:00Z") });

    expect(result.totalDeleted).toBe(10);
    expect(infoMock).toHaveBeenCalledWith(
      "Pruned operation task history",
      expect.objectContaining({ totalDeleted: 10, perSource: expect.any(Object) }),
    );
  });

  it("totalDeleted=0 → logger.info 不调 (避免噪音)", async () => {
    await pruneOperationTaskHistory({ now: new Date("2026-06-15T00:00:00Z") });
    expect(infoMock).not.toHaveBeenCalled();
  });

  it("keepLatest 按 teamId 分组: 每个租户各留满 N 条, 活跃租户占不掉别人的名额", async () => {
    mockPrisma.commandRequest.groupBy.mockResolvedValue([
      { teamId: "team_busy" },
      { teamId: "team_quiet" },
    ]);
    mockPrisma.commandRequest.findMany
      .mockResolvedValueOnce([{ id: "busy1" }, { id: "busy2" }])
      .mockResolvedValueOnce([{ id: "quiet1" }]);
    mockPrisma.commandRequest.deleteMany
      .mockResolvedValueOnce({ count: 40 })
      .mockResolvedValueOnce({ count: 2 });

    const result = await pruneOperationTaskHistory({
      now: new Date("2026-06-15T00:00:00Z"),
      keepLatest: 2,
    });

    // 两个租户各跑一次 retain 查询, 各自的 take 都是完整的 keepLatest
    expect(mockPrisma.commandRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ teamId: "team_busy" }), take: 2 }),
    );
    expect(mockPrisma.commandRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ teamId: "team_quiet" }), take: 2 }),
    );
    // team_quiet 的删除条件带自己的 teamId 且排除自己保留的 id,
    // 不会因为 team_busy 抢满全平台前 N 名而被整段删掉
    expect(mockPrisma.commandRequest.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          teamId: "team_quiet",
          id: { notIn: ["quiet1"] },
        }),
      }),
    );
    expect(result.perSource.command?.scanned).toBe(3);
    expect(result.perSource.command?.deleted).toBe(42);
  });

  it("teamId 分组数超过上限 → 只处理前 200 个并 warn, 其余留给下一轮", async () => {
    const scopes = Array.from({ length: 201 }, (_, index) => ({ teamId: `team_${index}` }));
    mockPrisma.commandRequest.groupBy.mockResolvedValue(scopes);

    await pruneOperationTaskHistory({ now: new Date("2026-06-15T00:00:00Z") });

    expect(mockPrisma.commandRequest.findMany).toHaveBeenCalledTimes(200);
    expect(warnMock).toHaveBeenCalledWith(
      "Retention team scope cap reached; remaining scopes prune on the next run",
      { source: "command", scopes: 201, cap: 200 },
    );
  });
});

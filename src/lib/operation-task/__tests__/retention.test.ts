import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for pruneOperationTaskHistory — TR-006 跨来源统一长期保留策略
 *
 * 覆盖：
 *   - 5 个来源（command/download/sync/backup/deployment）正确裁剪 completed 状态
 *   - 保留最新 keepLatest 条不被删
 *   - olderThan 过滤正确
 *   - 单来源失败不影响其他来源
 *   - 默认 90 天 / 100 条
 */

const { mockPrisma, infoMock, warnMock } = vi.hoisted(() => ({
  mockPrisma: {
    commandRequest: { findMany: vi.fn(), deleteMany: vi.fn() },
    downloadTask: { findMany: vi.fn(), deleteMany: vi.fn() },
    syncJob: { findMany: vi.fn(), deleteMany: vi.fn() },
    backupRecord: { findMany: vi.fn(), deleteMany: vi.fn() },
    deploymentRun: { findMany: vi.fn(), deleteMany: vi.fn() },
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
        where: { status: { in: ["COMPLETED", "FAILED", "REJECTED", "CANCELLED"] } },
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
      expect.objectContaining({ where: { status: { in: ["COMPLETED", "FAILED", "CANCELLED"] } } }),
    );
    expect(mockPrisma.deploymentRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ["COMPLETED", "FAILED", "CANCELLED", "ROLLED_BACK"] } } }),
    );
    // SyncJob is long-lived config; BackupRecord is owned by backup retention with file unlink.
    expect(mockPrisma.syncJob.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.syncJob.deleteMany).not.toHaveBeenCalled();
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
});

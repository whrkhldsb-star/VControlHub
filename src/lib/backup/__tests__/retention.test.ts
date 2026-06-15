import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  mockPrisma,
  rmMock,
  statMock,
} = vi.hoisted(() => ({
  mockPrisma: {
    backupRecord: {
      findMany: vi.fn(),
      delete: vi.fn(),
    },
  },
  rmMock: vi.fn(),
  statMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("node:fs/promises", () => ({
  default: { rm: rmMock, stat: statMock },
  rm: rmMock,
  stat: statMock,
}));

const { pruneOldBackupRecords, pruneOldBackupRecordsNow } = await import("../service");

const baseRecord = (overrides: Record<string, unknown>) => ({
  id: "bak_default",
  type: "DATABASE",
  status: "COMPLETED",
  filePath: "backups/db.sql.gz",
  fileSize: "1024",
  createdAt: new Date("2026-05-01T00:00:00Z"),
  completedAt: new Date("2026-05-01T00:00:00Z"),
  ...overrides,
});

describe("pruneOldBackupRecords — pure planner", () => {
  it("never returns records inside the keep-latest window that are also within the cutoff", () => {
    const now = new Date("2026-06-15T00:00:00Z");
    const recent = baseRecord({ id: "bak_recent_1", completedAt: new Date("2026-06-10T00:00:00Z") });
    const plan = pruneOldBackupRecords([recent], { olderThanDays: 30, keepLatestPerType: 3, now });
    expect(plan.candidates).toEqual([]);
  });

  it("marks records beyond the keep window but past the cutoff as exceeds-keep-latest", () => {
    const now = new Date("2026-06-15T00:00:00Z");
    const records = [
      baseRecord({ id: "bak_keep_1", completedAt: new Date("2026-06-10T00:00:00Z") }),
      baseRecord({ id: "bak_keep_2", completedAt: new Date("2026-06-08T00:00:00Z") }),
      baseRecord({ id: "bak_keep_3", completedAt: new Date("2026-06-05T00:00:00Z") }),
      baseRecord({ id: "bak_old_1", completedAt: new Date("2026-04-01T00:00:00Z") }),
      baseRecord({ id: "bak_old_2", completedAt: new Date("2026-03-01T00:00:00Z") }),
    ];
    const plan = pruneOldBackupRecords(records, { olderThanDays: 30, keepLatestPerType: 3, now });
    // FIFO: oldest first.
    expect(plan.candidates.map((c) => c.id)).toEqual(["bak_old_2", "bak_old_1"]);
    expect(plan.candidates.every((c) => c.reason === "exceeds-keep-latest")).toBe(true);
  });

  it("marks records inside the keep window that are past the cutoff as older-than-cutoff (safety floor)", () => {
    const now = new Date("2026-06-15T00:00:00Z");
    const records = [
      baseRecord({ id: "bak_oldest", completedAt: new Date("2025-01-01T00:00:00Z") }),
      baseRecord({ id: "bak_middle", completedAt: new Date("2025-02-01T00:00:00Z") }),
      baseRecord({ id: "bak_newest", completedAt: new Date("2025-03-01T00:00:00Z") }),
    ];
    const plan = pruneOldBackupRecords(records, { olderThanDays: 30, keepLatestPerType: 3, now });
    expect(plan.candidates.map((c) => c.id)).toEqual(["bak_oldest", "bak_middle", "bak_newest"]);
    expect(plan.candidates.every((c) => c.reason === "older-than-cutoff")).toBe(true);
  });

  it("skips non-COMPLETED records and unknown backup types", () => {
    const now = new Date("2026-06-15T00:00:00Z");
    const records = [
      baseRecord({ id: "bak_failed", status: "FAILED", completedAt: new Date("2025-01-01T00:00:00Z") }),
      baseRecord({ id: "bak_running", status: "RUNNING", completedAt: undefined, createdAt: new Date("2025-01-01T00:00:00Z") }),
      baseRecord({ id: "bak_unknown_type", type: "FOO", completedAt: new Date("2025-01-01T00:00:00Z") }),
    ];
    const plan = pruneOldBackupRecords(records, { olderThanDays: 30, keepLatestPerType: 3, now });
    expect(plan.candidates).toEqual([]);
  });

  it("applies keepLatestPerType per type, not globally", () => {
    const now = new Date("2026-06-15T00:00:00Z");
    const records = [
      // 3 newest DATABASE, 1 stale DATABASE
      baseRecord({ id: "db_new_1", type: "DATABASE", completedAt: new Date("2026-06-10T00:00:00Z") }),
      baseRecord({ id: "db_new_2", type: "DATABASE", completedAt: new Date("2026-06-08T00:00:00Z") }),
      baseRecord({ id: "db_new_3", type: "DATABASE", completedAt: new Date("2026-06-05T00:00:00Z") }),
      baseRecord({ id: "db_old", type: "DATABASE", completedAt: new Date("2026-04-01T00:00:00Z") }),
      // 2 FILES (within keep window for FILES)
      baseRecord({ id: "files_new_1", type: "FILES", filePath: "backups/files-1.tar.gz", completedAt: new Date("2026-06-10T00:00:00Z") }),
      baseRecord({ id: "files_new_2", type: "FILES", filePath: "backups/files-2.tar.gz", completedAt: new Date("2026-06-09T00:00:00Z") }),
    ];
    const plan = pruneOldBackupRecords(records, { olderThanDays: 30, keepLatestPerType: 3, now });
    expect(plan.candidates.map((c) => c.id)).toEqual(["db_old"]);
    expect(plan.oldestKeptByType.DATABASE).toEqual(new Date("2026-06-05T00:00:00Z"));
    expect(plan.oldestKeptByType.FILES).toBeNull();
  });

  it("uses default olderThanDays=30 and keepLatestPerType=3 when no options provided", () => {
    const now = new Date("2026-06-15T00:00:00Z");
    const plan = pruneOldBackupRecords([], { now });
    expect(plan.olderThanDays).toBe(30);
    expect(plan.keepLatestPerType).toBe(3);
    expect(plan.cutoff).toEqual(new Date("2026-05-16T00:00:00Z"));
  });
});

describe("pruneOldBackupRecordsNow — runtime orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BACKUP_DIR = "/var/backups/vcontrolhub";
  });

  it("returns zero counts when no records match retention", async () => {
    mockPrisma.backupRecord.findMany.mockResolvedValueOnce([
      baseRecord({ id: "bak_recent", completedAt: new Date("2026-06-10T00:00:00Z") }),
    ]);
    const result = await pruneOldBackupRecordsNow({ projectRoot: "/opt/app" });
    expect(result.deletedRecords).toBe(0);
    expect(result.filesDeleted).toBe(0);
    expect(result.candidateIds).toEqual([]);
    expect(mockPrisma.backupRecord.delete).not.toHaveBeenCalled();
    expect(rmMock).not.toHaveBeenCalled();
  });

  it("deletes both DB row and file for matching candidates", async () => {
    mockPrisma.backupRecord.findMany.mockResolvedValueOnce([
      baseRecord({ id: "bak_old", completedAt: new Date("2026-04-01T00:00:00Z") }),
    ]);
    statMock.mockResolvedValueOnce({ size: 1024 });
    rmMock.mockResolvedValueOnce(undefined);
    mockPrisma.backupRecord.delete.mockResolvedValueOnce({ id: "bak_old" });

    const result = await pruneOldBackupRecordsNow({ projectRoot: "/opt/app" });

    expect(result.deletedRecords).toBe(1);
    expect(result.filesDeleted).toBe(1);
    expect(result.candidateIds).toEqual(["bak_old"]);
    expect(statMock).toHaveBeenCalledWith("/var/backups/vcontrolhub/backups/db.sql.gz");
    expect(rmMock).toHaveBeenCalledWith("/var/backups/vcontrolhub/backups/db.sql.gz", { force: true });
    expect(mockPrisma.backupRecord.delete).toHaveBeenCalledWith({ where: { id: "bak_old" } });
  });

  it("skips missing files but still deletes the DB row (no orphan DB rows)", async () => {
    mockPrisma.backupRecord.findMany.mockResolvedValueOnce([
      baseRecord({ id: "bak_missing_file", completedAt: new Date("2026-04-01T00:00:00Z") }),
    ]);
    const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    statMock.mockRejectedValueOnce(enoent);
    mockPrisma.backupRecord.delete.mockResolvedValueOnce({ id: "bak_missing_file" });

    const result = await pruneOldBackupRecordsNow({ projectRoot: "/opt/app" });

    expect(result.deletedRecords).toBe(1);
    expect(result.filesDeleted).toBe(0);
    expect(result.filesSkipped).toBe(1);
    expect(result.fileErrors).toEqual([]);
    expect(rmMock).not.toHaveBeenCalled();
    expect(mockPrisma.backupRecord.delete).toHaveBeenCalledWith({ where: { id: "bak_missing_file" } });
  });

  it("records file errors but continues with DB delete for the same candidate", async () => {
    mockPrisma.backupRecord.findMany.mockResolvedValueOnce([
      baseRecord({ id: "bak_traversal", filePath: "../etc/passwd", completedAt: new Date("2026-04-01T00:00:00Z") }),
    ]);
    mockPrisma.backupRecord.delete.mockResolvedValueOnce({ id: "bak_traversal" });

    const result = await pruneOldBackupRecordsNow({ projectRoot: "/opt/app" });

    expect(result.deletedRecords).toBe(1);
    expect(result.filesDeleted).toBe(0);
    expect(result.fileErrors).toHaveLength(1);
    expect(result.fileErrors[0]).toContain("bak_traversal");
    expect(result.fileErrors[0]).toContain("可移植的相对路径");
    expect(mockPrisma.backupRecord.delete).toHaveBeenCalledWith({ where: { id: "bak_traversal" } });
  });

  it("processes candidates oldest-first (FIFO) for predictable cleanup order", async () => {
    mockPrisma.backupRecord.findMany.mockResolvedValueOnce([
      baseRecord({ id: "bak_b", completedAt: new Date("2026-04-15T00:00:00Z") }),
      baseRecord({ id: "bak_a", completedAt: new Date("2026-04-01T00:00:00Z") }),
      baseRecord({ id: "bak_c", completedAt: new Date("2026-04-20T00:00:00Z") }),
    ]);
    statMock.mockResolvedValue({ size: 1 });
    rmMock.mockResolvedValue(undefined);
    mockPrisma.backupRecord.delete.mockResolvedValue({});

    const result = await pruneOldBackupRecordsNow({ projectRoot: "/opt/app" });
    expect(result.candidateIds).toEqual(["bak_a", "bak_b", "bak_c"]);
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma, runFileMock, statMock } = vi.hoisted(() => ({
  mockPrisma: { backupRecord: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() } },
  runFileMock: vi.fn(),
  statMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("node:child_process", () => ({ default: { execFile: runFileMock }, execFile: runFileMock }));
vi.mock("node:fs/promises", () => ({ default: { stat: statMock }, stat: statMock }));

const {
  createBackupRecord,
  buildPortableBackupCommand,
  buildBackupRestoreCommand,
  buildRestoreCommand,
  resolveBackupPath,
  runBackupRecord,
  updateBackupRecordStatus,
  restoreBackupRecord,
  listBackupRecords,
} = await import("../service");

describe("backup service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BACKUP_DIR = "/var/backups/vcontrolhub";
    mockPrisma.backupRecord.create.mockImplementation(async ({ data }: any) => ({ id: "bak1", ...data }));
    mockPrisma.backupRecord.findMany.mockResolvedValue([]);
    mockPrisma.backupRecord.findUnique.mockResolvedValue({ id: "bak1", type: "DATABASE", status: "COMPLETED", filePath: "backups/database.sql.gz" });
    mockPrisma.backupRecord.update.mockImplementation(async ({ data }: any) => ({ id: "bak1", ...data }));
    runFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: (error: Error | null, result?: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: "ok", stderr: "" });
    });
    statMock.mockResolvedValue({ size: 1234 });
  });

  it("bounds backup list queries so backup history cannot hydrate unbounded rows", async () => {
    await listBackupRecords();

    expect(mockPrisma.backupRecord.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { creator: { select: { username: true, displayName: true } } },
    });
  });

  it("creates auditable backup records with portable relative paths", async () => {
    mockPrisma.backupRecord.create.mockImplementation(async ({ data }: any) => ({ id: "bak1", ...data }));
    const record = await createBackupRecord({ type: "DATABASE", createdBy: "u1", note: "manual" });

    expect(record.status).toBe("PENDING");
    expect(record.filePath).toMatch(/^backups\//);
    expect(record.filePath).not.toMatch(/^\/root\//);
  });

  it("executes the requested backup command and records the real artifact size", async () => {
    const record = await runBackupRecord({ type: "FULL", createdBy: "u1", note: "before upgrade", projectRoot: "/opt/app" });

    expect(runFileMock.mock.calls[0][0]).toBe("bash");
    expect(runFileMock.mock.calls[0][1]).toEqual(["deploy/backup.sh", "--full", expect.stringMatching(/\/var\/backups\/vcontrolhub\/backups\/full-.*\.tar\.gz$/)]);
    expect(runFileMock.mock.calls[0][2]).toEqual(expect.objectContaining({ cwd: "/opt/app", env: expect.objectContaining({ APP_DIR: "/opt/app" }) }));
    expect(mockPrisma.backupRecord.update).toHaveBeenNthCalledWith(1, { where: { id: "bak1" }, data: { status: "RUNNING" } });
    expect(mockPrisma.backupRecord.update).toHaveBeenNthCalledWith(2, {
      where: { id: "bak1" },
      data: expect.objectContaining({ status: "COMPLETED", fileSize: "1234", errorMessage: null }),
    });
    expect(record.status).toBe("COMPLETED");
  });

  it("marks backup records failed when the real backup command fails", async () => {
    runFileMock.mockImplementationOnce((_file: string, _args: string[], _opts: unknown, cb: (error: Error | null) => void) => cb(new Error("tar failed")));

    const record = await runBackupRecord({ type: "FILES", createdBy: "u1", projectRoot: "/opt/app" });

    expect(runFileMock.mock.calls[0][0]).toBe("bash");
    expect(runFileMock.mock.calls[0][1]).toEqual(["deploy/backup.sh", "--files", expect.stringMatching(/\/var\/backups\/vcontrolhub\/backups\/files-.*\.tar\.gz$/)]);
    expect(record.status).toBe("FAILED");
    expect(record.errorMessage).toContain("tar failed");
    expect(statMock).not.toHaveBeenCalled();
  });

  it("builds backup commands that match each requested backup type", () => {
    const databaseCommand = buildPortableBackupCommand({ projectRoot: "/opt/whrkhldsb", outputPath: "backups/db.dump", type: "DATABASE" });
    const filesCommand = buildPortableBackupCommand({ projectRoot: "/opt/whrkhldsb", outputPath: "backups/files.tar.gz", type: "FILES" });
    const fullCommand = buildPortableBackupCommand({ projectRoot: "/opt/whrkhldsb", outputPath: "backups/full.tar.gz", type: "FULL" });

    expect(databaseCommand).toContain("deploy/backup.sh");
    expect(databaseCommand).not.toContain("--files");
    expect(databaseCommand).not.toContain("--full");
    expect(filesCommand).toContain("deploy/backup.sh --files");
    expect(fullCommand).toContain("deploy/backup.sh --full");
    for (const command of [databaseCommand, filesCommand, fullCommand]) {
      expect(command).toContain("backups/");
      expect(command).not.toMatch(/PASSWORD|TOKEN|SECRET|PRIVATE_KEY/i);
    }
  });

  it("creates backup records with type-specific portable file extensions", async () => {
    mockPrisma.backupRecord.create.mockImplementation(async ({ data }: any) => ({ id: "bak1", ...data }));

    const db = await createBackupRecord({ type: "DATABASE", createdBy: "u1" });
    const files = await createBackupRecord({ type: "FILES", createdBy: "u1" });
    const full = await createBackupRecord({ type: "FULL", createdBy: "u1" });

    expect(db.filePath).toMatch(/^backups\/database-.*\.sql\.gz$/);
    expect(files.filePath).toMatch(/^backups\/files-.*\.tar\.gz$/);
    expect(full.filePath).toMatch(/^backups\/full-.*\.tar\.gz$/);
  });

  it("rejects non-portable backup paths before resolving them", () => {
    for (const unsafe of ["/tmp/app.dump", "../app.dump", "backups/../app.dump", "backups//app.dump", "backups/app\\evil.dump", "", "."]) {
      expect(() => resolveBackupPath("/opt/whrkhldsb", unsafe)).toThrow("备份路径必须是可移植的相对路径");
    }
    expect(resolveBackupPath("/opt/whrkhldsb", "backups/app.dump")).toBe("/var/backups/vcontrolhub/backups/app.dump");
  });

  it("updates status metadata without requiring callers to know prisma fields", async () => {
    const completedAt = new Date("2026-05-06T00:00:00.000Z");
    mockPrisma.backupRecord.update.mockImplementation(async ({ data }: any) => ({ id: "bak1", ...data }));

    const record = await updateBackupRecordStatus("bak1", { status: "COMPLETED", fileSize: 1234, completedAt });

    expect(record.status).toBe("COMPLETED");
    expect(record.fileSize).toBe("1234");
    expect(record.completedAt).toBe(completedAt);
    expect(mockPrisma.backupRecord.update).toHaveBeenCalledWith({ where: { id: "bak1" }, data: { status: "COMPLETED", fileSize: "1234", completedAt } });
  });

  it("builds restore command from a portable backup path without auto-executing dangerous restore", () => {
    const command = buildRestoreCommand({ projectRoot: "/opt/whrkhldsb", backupPath: "backups/full.dump" });
    expect(command).toContain("scripts/restore-db.sh");
    expect(command).toContain("backups/full.dump");
    expect(command).not.toMatch(/DATABASE_URL=.*postgres|PASSWORD|TOKEN|SECRET|PRIVATE_KEY/i);
  });

  it("builds restore commands that match the stored backup artifact type", () => {
    const databaseCommand = buildBackupRestoreCommand({ projectRoot: "/opt/whrkhldsb", backupPath: "backups/database.sql.gz", type: "DATABASE" });
    const filesCommand = buildBackupRestoreCommand({ projectRoot: "/opt/whrkhldsb", backupPath: "backups/files.tar.gz", type: "FILES" });
    const fullCommand = buildBackupRestoreCommand({ projectRoot: "/opt/whrkhldsb", backupPath: "backups/full.tar.gz", type: "FULL" });

    expect(databaseCommand).toContain("scripts/restore-db.sh");
    expect(databaseCommand).toContain("backups/database.sql.gz");
    expect(filesCommand).toContain("tar -xzf 'backups/files.tar.gz'");
    expect(filesCommand).not.toContain("restore-db.sh");
    expect(fullCommand).toContain("tar -xzf 'backups/full.tar.gz'");
    expect(fullCommand).not.toContain("restore-db.sh");
    for (const command of [databaseCommand, filesCommand, fullCommand]) {
      expect(command).not.toMatch(/DATABASE_URL=.*postgres|PASSWORD|TOKEN|SECRET|PRIVATE_KEY/i);
    }
  });

  it("executes database restore only after explicit confirmation and completed record validation", async () => {
    const result = await restoreBackupRecord({ id: "bak1", confirm: "RESTORE", projectRoot: "/opt/app" });

    expect(mockPrisma.backupRecord.findUnique).toHaveBeenCalledWith({ where: { id: "bak1" } });
    expect(statMock).toHaveBeenCalledWith("/var/backups/vcontrolhub/backups/database.sql.gz");
    expect(runFileMock.mock.calls[0][0]).toBe("bash");
    expect(runFileMock.mock.calls[0][1]).toEqual(["scripts/restore-db.sh", "/var/backups/vcontrolhub/backups/database.sql.gz"]);
    expect(runFileMock.mock.calls[0][2]).toEqual(expect.objectContaining({ cwd: "/opt/app", env: expect.objectContaining({ APP_DIR: "/opt/app", CONFIRM_RESTORE: "1" }) }));
    expect(result).toMatchObject({ id: "bak1", type: "DATABASE", filePath: "backups/database.sql.gz" });
  });

  it("uses tar extraction for completed FILES/FULL restore records", async () => {
    mockPrisma.backupRecord.findUnique.mockResolvedValueOnce({ id: "bak2", type: "FILES", status: "COMPLETED", filePath: "backups/files.tar.gz" });

    await restoreBackupRecord({ id: "bak2", confirm: "RESTORE", projectRoot: "/opt/app" });

    expect(statMock).toHaveBeenCalledWith("/var/backups/vcontrolhub/backups/files.tar.gz");
    expect(runFileMock.mock.calls[0][0]).toBe("tar");
    expect(runFileMock.mock.calls[0][1]).toEqual(["-xzf", "/var/backups/vcontrolhub/backups/files.tar.gz", "-C", "/opt/app"]);
    expect(runFileMock.mock.calls[0][2]).toEqual(expect.objectContaining({ cwd: "/opt/app" }));
  });

  it("rejects restore before executing when confirmation, path, or status is unsafe", async () => {
    await expect(restoreBackupRecord({ id: "bak1", confirm: "NOPE", projectRoot: "/opt/app" })).rejects.toThrow("恢复操作需要明确确认");
    expect(runFileMock).not.toHaveBeenCalled();

    mockPrisma.backupRecord.findUnique.mockResolvedValueOnce({ id: "bak3", type: "DATABASE", status: "FAILED", filePath: "backups/database.sql.gz" });
    await expect(restoreBackupRecord({ id: "bak3", confirm: "RESTORE", projectRoot: "/opt/app" })).rejects.toThrow("只能恢复已完成的备份");

    mockPrisma.backupRecord.findUnique.mockResolvedValueOnce({ id: "bak4", type: "DATABASE", status: "COMPLETED", filePath: "../database.sql.gz" });
    await expect(restoreBackupRecord({ id: "bak4", confirm: "RESTORE", projectRoot: "/opt/app" })).rejects.toThrow("备份路径必须是可移植的相对路径");
    expect(runFileMock).not.toHaveBeenCalled();
  });
});

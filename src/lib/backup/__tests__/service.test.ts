import { describe, expect, it, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";

const { mockPrisma, runBackupCommandMock, statMock, createReadStreamMock } = vi.hoisted(() => ({
  mockPrisma: { backupRecord: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() } },
  runBackupCommandMock: vi.fn(),
  statMock: vi.fn(),
  createReadStreamMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/backup/command-runner", () => {
  const isMissingBackupBinaryError = (error: unknown) => {
    if (!error || typeof error !== "object") return false;
    return (error as { code?: unknown }).code === "ENOENT";
  };
  const backupCommandErrorMessage = (error: unknown) => {
    if (isMissingBackupBinaryError(error)) {
      return "bash is not installed or not in PATH. Please ask the administrator to install bash or fix PATH and retry.";
    }
    if (error instanceof Error) return error.message;
    return "Backup execution failed";
  };
  return {
    runBackupCommand: runBackupCommandMock,
    isMissingBackupBinaryError,
    backupCommandErrorMessage,
  };
});
vi.mock("node:fs/promises", () => ({ default: { stat: statMock }, stat: statMock }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: { ...actual, createReadStream: createReadStreamMock },
    createReadStream: createReadStreamMock,
  };
});

const {
  createBackupRecord,
  buildPortableBackupCommand,
  buildScheduledBackupCommand,
  buildBackupRestoreCommand,
  buildRestoreCommand,
  resolveBackupPath,
  runBackupRecord,
  updateBackupRecordStatus,
  voidBackupRecord,
  prepareBackupRecordRetry,
  restoreBackupRecord,
  listBackupRecords,
  formatBackupSize,
  summarizeBackupPolicy,
} = await import("../service");

describe("backup service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BACKUP_DIR = "/var/backups/vcontrolhub";
    let lastCreatedBackupRecord: any = null;
    mockPrisma.backupRecord.create.mockImplementation(async ({ data }: any) => {
      lastCreatedBackupRecord = { id: "bak1", ...data };
      return lastCreatedBackupRecord;
    });
    mockPrisma.backupRecord.findMany.mockResolvedValue([]);
    mockPrisma.backupRecord.findUnique.mockImplementation(async () => lastCreatedBackupRecord ?? { id: "bak1", type: "DATABASE", status: "COMPLETED", filePath: "backups/database.sql.gz", checksumSha256: "a92e0ec81286ff0f9ccf5982a22a83a0b70082446d5fd7af0eb9a3ceacd16c86" });
    mockPrisma.backupRecord.update.mockImplementation(async ({ data }: any) => ({ id: "bak1", ...data }));
    runBackupCommandMock.mockResolvedValue({ stdout: "ok", stderr: "" });
    statMock.mockResolvedValue({ size: 1234 });
    createReadStreamMock.mockImplementation(() => Readable.from(["backup-content"]));
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

    expect(runBackupCommandMock.mock.calls[0]![0]).toEqual(expect.objectContaining({
      file: "bash",
      args: ["deploy/backup.sh", "--full", expect.stringMatching(/\/var\/backups\/vcontrolhub\/backups\/full-.*\.tar\.gz$/)],
      options: expect.objectContaining({ cwd: "/opt/app", env: expect.objectContaining({ APP_DIR: "/opt/app" }) }),
    }));
    expect(mockPrisma.backupRecord.update).toHaveBeenNthCalledWith(1, { where: { id: "bak1" }, data: { status: "RUNNING" } });
    expect(mockPrisma.backupRecord.update).toHaveBeenNthCalledWith(2, {
      where: { id: "bak1" },
      data: expect.objectContaining({ status: "COMPLETED", fileSize: "1234", errorMessage: null, checksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    });
    expect(record.status).toBe("COMPLETED");
  });

  it("marks backup records failed when the real backup command fails", async () => {
    runBackupCommandMock.mockRejectedValueOnce(new Error("tar failed"));

    const record = await runBackupRecord({ type: "FILES", createdBy: "u1", projectRoot: "/opt/app" });

    expect(runBackupCommandMock.mock.calls[0]![0]).toEqual(expect.objectContaining({
      file: "bash",
      args: ["deploy/backup.sh", "--files", expect.stringMatching(/\/var\/backups\/vcontrolhub\/backups\/files-.*\.tar\.gz$/)],
    }));
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

  it("builds scheduled backup commands that let deploy/backup.sh create timestamped artifacts", () => {
    const databaseCommand = buildScheduledBackupCommand({ projectRoot: "/opt/whrkhldsb", type: "DATABASE" });
    const filesCommand = buildScheduledBackupCommand({ projectRoot: "/opt/whrkhldsb", type: "FILES" });
    const fullCommand = buildScheduledBackupCommand({ projectRoot: "/opt/whrkhldsb", type: "FULL" });

    expect(databaseCommand).toBe("cd '/opt/whrkhldsb' && bash deploy/backup.sh");
    expect(filesCommand).toBe("cd '/opt/whrkhldsb' && bash deploy/backup.sh --files");
    expect(fullCommand).toBe("cd '/opt/whrkhldsb' && bash deploy/backup.sh --full");
    for (const command of [databaseCommand, filesCommand, fullCommand]) {
      expect(command).not.toMatch(/PASSWORD|TOKEN|SECRET|PRIVATE_KEY/i);
      expect(command).not.toContain("$(date");
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
      expect(() => resolveBackupPath("/opt/whrkhldsb", unsafe)).toThrow("Backup path must be a portable relative path");
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

  it("marks stale pending or failed backup records void without deleting audit history", async () => {
    mockPrisma.backupRecord.findUnique.mockResolvedValueOnce({ id: "bak-pending", type: "DATABASE", status: "PENDING", filePath: "backups/stale.sql.gz", errorMessage: null });
    mockPrisma.backupRecord.update.mockImplementation(async ({ data }: any) => ({ id: "bak-pending", ...data }));

    const record = await voidBackupRecord({ id: "bak-pending", reason: "stale queued record" });

    expect(record.status).toBe("FAILED");
    expect(record.errorMessage).toMatch(/^Voided:/);
    expect(mockPrisma.backupRecord.update).toHaveBeenCalledWith({ where: { id: "bak-pending" }, data: { status: "FAILED", errorMessage: "Voided: stale queued record" } });
  });

  it("refuses to void completed or running backup records", async () => {
    mockPrisma.backupRecord.findUnique.mockResolvedValueOnce({ id: "bak-completed", type: "DATABASE", status: "COMPLETED", filePath: "backups/db.sql.gz" });
    await expect(voidBackupRecord({ id: "bak-completed", reason: "cleanup" })).rejects.toThrow("Completed backups cannot be voided");

    mockPrisma.backupRecord.findUnique.mockResolvedValueOnce({ id: "bak-running", type: "DATABASE", status: "RUNNING", filePath: "backups/db.sql.gz" });
    await expect(voidBackupRecord({ id: "bak-running", reason: "cleanup" })).rejects.toThrow("Running backups cannot be voided");
  });

  it("prepares failed backup records for retry without deleting audit history", async () => {
    mockPrisma.backupRecord.findUnique.mockResolvedValueOnce({ id: "bak-failed", type: "DATABASE", status: "FAILED", filePath: "backups/failed.sql.gz", errorMessage: "readonly path" });
    mockPrisma.backupRecord.update.mockImplementation(async ({ data }: any) => ({ id: "bak-failed", ...data }));

    const record = await prepareBackupRecordRetry({ id: "bak-failed" });

    expect(record.status).toBe("PENDING");
    expect(record.errorMessage).toBeNull();
    expect(mockPrisma.backupRecord.update).toHaveBeenCalledWith({ where: { id: "bak-failed" }, data: { status: "PENDING", errorMessage: null } });
  });

  it("refuses unsafe backup retry states and paths", async () => {
    mockPrisma.backupRecord.findUnique.mockResolvedValueOnce({ id: "bak-completed", type: "DATABASE", status: "COMPLETED", filePath: "backups/db.sql.gz" });
    await expect(prepareBackupRecordRetry({ id: "bak-completed" })).rejects.toThrow("Completed backups cannot be retried");

    mockPrisma.backupRecord.findUnique.mockResolvedValueOnce({ id: "bak-running", type: "DATABASE", status: "RUNNING", filePath: "backups/db.sql.gz" });
    await expect(prepareBackupRecordRetry({ id: "bak-running" })).rejects.toThrow("Running backups cannot be retried");

    mockPrisma.backupRecord.findUnique.mockResolvedValueOnce({ id: "bak-pending", type: "DATABASE", status: "PENDING", filePath: "backups/db.sql.gz" });
    await expect(prepareBackupRecordRetry({ id: "bak-pending" })).rejects.toThrow("Pending backups cannot be re-queued");

    mockPrisma.backupRecord.findUnique.mockResolvedValueOnce({ id: "bak-bad-path", type: "DATABASE", status: "FAILED", filePath: "../db.sql.gz" });
    await expect(prepareBackupRecordRetry({ id: "bak-bad-path" })).rejects.toThrow("Backup path must be a portable relative path");
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
    expect(runBackupCommandMock.mock.calls[0]![0]).toEqual(expect.objectContaining({
      file: "bash",
      args: ["scripts/restore-db.sh", "/var/backups/vcontrolhub/backups/database.sql.gz"],
      options: expect.objectContaining({ cwd: "/opt/app", env: expect.objectContaining({ APP_DIR: "/opt/app", CONFIRM_RESTORE: "1" }) }),
    }));
    expect(result).toMatchObject({ id: "bak1", type: "DATABASE", filePath: "backups/database.sql.gz" });
  });

  it("uses tar extraction for completed FILES/FULL restore records", async () => {
    mockPrisma.backupRecord.findUnique.mockResolvedValueOnce({ id: "bak2", type: "FILES", status: "COMPLETED", filePath: "backups/files.tar.gz", checksumSha256: "a92e0ec81286ff0f9ccf5982a22a83a0b70082446d5fd7af0eb9a3ceacd16c86" });

    await restoreBackupRecord({ id: "bak2", confirm: "RESTORE", projectRoot: "/opt/app" });

    expect(statMock).toHaveBeenCalledWith("/var/backups/vcontrolhub/backups/files.tar.gz");
    expect(runBackupCommandMock.mock.calls[0]![0]).toEqual(expect.objectContaining({
      file: "tar",
      args: ["-xzf", "/var/backups/vcontrolhub/backups/files.tar.gz", "-C", "/opt/app"],
      options: expect.objectContaining({ cwd: "/opt/app" }),
    }));
  });

	it("rejects restore before executing when confirmation, path, or status is unsafe", async () => {
    await expect(restoreBackupRecord({ id: "bak1", confirm: "NOPE", projectRoot: "/opt/app" })).rejects.toThrow("Restore operation requires explicit confirmation");
    expect(runBackupCommandMock).not.toHaveBeenCalled();

    mockPrisma.backupRecord.findUnique.mockResolvedValueOnce({ id: "bak3", type: "DATABASE", status: "FAILED", filePath: "backups/database.sql.gz" });
    await expect(restoreBackupRecord({ id: "bak3", confirm: "RESTORE", projectRoot: "/opt/app" })).rejects.toThrow("Only completed backups can be restored");

    mockPrisma.backupRecord.findUnique.mockResolvedValueOnce({ id: "bak4", type: "DATABASE", status: "COMPLETED", filePath: "../database.sql.gz" });
    await expect(restoreBackupRecord({ id: "bak4", confirm: "RESTORE", projectRoot: "/opt/app" })).rejects.toThrow("Backup path must be a portable relative path");
    expect(runBackupCommandMock).not.toHaveBeenCalled();
	});

	it("refuses restore when the artifact checksum is missing or mismatched", async () => {
		mockPrisma.backupRecord.findUnique.mockResolvedValueOnce({ id: "bak5", type: "DATABASE", status: "COMPLETED", filePath: "backups/database.sql.gz", checksumSha256: null });
		await expect(restoreBackupRecord({ id: "bak5", confirm: "RESTORE", projectRoot: "/opt/app" })).rejects.toThrow("checksum is missing");

		mockPrisma.backupRecord.findUnique.mockResolvedValueOnce({ id: "bak6", type: "DATABASE", status: "COMPLETED", filePath: "backups/database.sql.gz", checksumSha256: "0".repeat(64) });
		await expect(restoreBackupRecord({ id: "bak6", confirm: "RESTORE", projectRoot: "/opt/app" })).rejects.toThrow("checksum verification failed");
		expect(runBackupCommandMock).not.toHaveBeenCalled();
	});

  it("summarizes backup policy capacity, type mix, retention hints, and failure reasons", () => {
    const summary = summarizeBackupPolicy([
      { id: "bak_summary_1", type: "DATABASE", status: "COMPLETED", filePath: "backups/db.sql.gz", fileSize: "1048576", createdAt: new Date("2026-04-01T00:00:00Z"), completedAt: new Date("2026-04-01T00:00:00Z") },
      { id: "bak_summary_2", type: "FILES", status: "COMPLETED", filePath: "backups/files.tar.gz", fileSize: 2 * 1024 * 1024, createdAt: new Date("2026-05-20T00:00:00Z"), completedAt: new Date("2026-05-20T00:00:00Z") },
      { id: "bak_summary_3", type: "FULL", status: "FAILED", filePath: "backups/full.tar.gz", fileSize: "999999", errorMessage: "readonly path", createdAt: new Date("2026-05-21T00:00:00Z") },
      { id: "bak_summary_4", type: "FILES", status: "FAILED", filePath: "backups/files-old.tar.gz", fileSize: null, errorMessage: "EACCES: permission denied", createdAt: new Date("2026-05-23T00:00:00Z") },
      { id: "bak_summary_5", type: "DATABASE", status: "FAILED", filePath: "backups/missing.sql.gz", fileSize: null, errorMessage: "No such file or directory", createdAt: new Date("2026-05-24T00:00:00Z") },
      { id: "bak_summary_6", type: "DATABASE", status: "RUNNING", fileSize: null, createdAt: new Date("2026-05-22T00:00:00Z") },
    ], new Date("2026-06-01T00:00:00Z"));

    expect(summary.totalRecords).toBe(6);
    expect(summary.completedRecords).toBe(2);
    expect(summary.failedRecords).toBe(3);
    expect(summary.runningRecords).toBe(1);
    expect(summary.totalCompletedSizeBytes).toBe(3 * 1024 * 1024);
    expect(summary.recordsOlderThan30Days).toBe(1);
    expect(summary.byType.DATABASE).toEqual({ count: 1, sizeBytes: 1024 * 1024 });
    expect(summary.byType.FILES).toEqual({ count: 1, sizeBytes: 2 * 1024 * 1024 });
    expect(summary.byType.FULL).toEqual({ count: 0, sizeBytes: 0 });
    expect(summary.failureSummary).toEqual([
      {
        category: "permission",
        label: "Permission or read-only path",
        remediation: "Verify that BACKUP_DIR or /var/backups/<slug> is a writable directory. Mark old read-only path failures as voided or retry with a new system backup root.",
        count: 2,
        latestMessage: "EACCES: permission denied",
        latestRecordPath: "backups/files-old.tar.gz",
      },
      {
        category: "missing",
        label: "File or directory not found",
        remediation: "Confirm that source directories, restore targets, and historical artifacts referenced by the backup script still exist. Preserve audit trails for missing artifacts and mark them as voided.",
        count: 1,
        latestMessage: "No such file or directory",
        latestRecordPath: "backups/missing.sql.gz",
      },
    ]);
    expect(summary.largestCompleted).toEqual({ type: "FILES", filePath: "backups/files.tar.gz", sizeBytes: 2 * 1024 * 1024 });
  });

  it("formats backup sizes without rounding small artifacts down to 0 MB", () => {
    expect(formatBackupSize(null)).toBe("Pending");
    expect(formatBackupSize("512")).toBe("512 B");
    expect(formatBackupSize(1536)).toBe("1.5 KB");
    expect(formatBackupSize(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatBackupSize(3 * 1024 * 1024 * 1024)).toBe("3.00 GB");
  });
});

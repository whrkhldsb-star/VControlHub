import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { backupRecord: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const {
  createBackupRecord,
  buildPortableBackupCommand,
  buildRestoreCommand,
  resolveBackupPath,
  updateBackupRecordStatus,
} = await import("../service");

describe("backup service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates auditable backup records with portable relative paths", async () => {
    mockPrisma.backupRecord.create.mockImplementation(async ({ data }: any) => ({ id: "bak1", ...data }));
    const record = await createBackupRecord({ type: "DATABASE", createdBy: "u1", note: "manual" });

    expect(record.status).toBe("PENDING");
    expect(record.filePath).toMatch(/^backups\//);
    expect(record.filePath).not.toMatch(/^\/root\//);
  });

  it("builds backup command using deploy script and never embeds credentials", () => {
    const command = buildPortableBackupCommand({ projectRoot: "/opt/whrkhldsb", outputPath: "backups/app.dump" });
    expect(command).toContain("deploy/backup.sh");
    expect(command).toContain("backups/app.dump");
    expect(command).not.toMatch(/PASSWORD|TOKEN|SECRET|PRIVATE_KEY/i);
  });

  it("rejects non-portable backup paths before resolving them", () => {
    for (const unsafe of ["/tmp/app.dump", "../app.dump", "backups/../app.dump", "backups//app.dump", "backups/app\\evil.dump", "", "."]) {
      expect(() => resolveBackupPath("/opt/whrkhldsb", unsafe)).toThrow("备份路径必须是可移植的相对路径");
    }
    expect(resolveBackupPath("/opt/whrkhldsb", "backups/app.dump")).toBe("/opt/whrkhldsb/backups/app.dump");
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
});

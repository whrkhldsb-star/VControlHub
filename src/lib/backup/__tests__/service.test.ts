import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: { backupRecord: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { createBackupRecord, buildPortableBackupCommand } = await import("../service");

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
});

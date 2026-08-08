import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    backupRecord: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/config/env", () => ({
  config: {
    app: { appDir: "", hostname: "test-host" },
    storage: { backupDir: "" },
  },
}));

// Dynamic import after mocks; we will set backupDir via env override by
// writing packages under a temp dir and patching resolve helpers through
// process cwd + BACKUP_DIR is read from config — re-mock per test with
// mutable config object.

describe("migration packages", () => {
  let tmp: string;
  let storage: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vch-mig-"));
    storage = path.join(tmp, "backups");
    await fs.mkdir(storage, { recursive: true });

    vi.doMock("@/lib/config/env", () => ({
      config: {
        app: { appDir: tmp, hostname: "test-host" },
        storage: { backupDir: storage },
        auth: {
          sessionCookieName: "test_session",
          sessionIssuer: "test",
          sessionAudience: "test",
        },
      },
    }));
    vi.doMock("@/lib/db", () => ({ prisma: prismaMock }));
    vi.doMock("@/lib/auth/team-scope", () => ({
      teamWhere: () => ({}),
    }));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("exports, validates, and imports a COMPLETED backup package", async () => {
    const { createHash } = await import("node:crypto");
    const relative = "backups/database-test.sql.gz";
    const absolute = path.join(storage, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const payload = Buffer.from("SELECT 1; -- migration fixture\n");
    await fs.writeFile(absolute, payload);
    const checksum = createHash("sha256").update(payload).digest("hex");

    prismaMock.backupRecord.findUnique.mockResolvedValue({
      id: "bak1",
      type: "DATABASE",
      status: "COMPLETED",
      filePath: relative,
      fileSize: String(payload.length),
      checksumSha256: checksum,
      note: "fixture",
      completedAt: new Date("2026-07-15T00:00:00.000Z"),
      teamId: "team1",
    });
    prismaMock.backupRecord.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "imported1",
      ...data,
    }));

    const mod = await import("../migration-package");

    const exported = await mod.exportMigrationPackage({
      backupId: "bak1",
      projectRoot: tmp,
    });
    expect(exported.packageId).toMatch(/^mig-/);
    expect(exported.manifest.backup.checksumSha256).toBe(checksum);

    const validated = await mod.validateMigrationPackage(exported.packageRelativeDir, tmp);
    expect(validated.ok).toBe(true);
    expect(validated.checksumMatches).toBe(true);
    if (validated.cleanup) await validated.cleanup();

    const imported = await mod.importMigrationPackage({
      packageRef: exported.packageRelativeDir,
      projectRoot: tmp,
      note: "from test",
    });
    expect(imported.backupId).toBe("imported1");
    expect(imported.type).toBe("DATABASE");
    expect(imported.checksumSha256).toBe(checksum);
    expect(prismaMock.backupRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETED",
          type: "DATABASE",
          checksumSha256: checksum,
        }),
      }),
    );

    const listed = await mod.listMigrationPackages(tmp);
    expect(listed.some((p) => p.packageId === exported.packageId)).toBe(true);
  });

  it("fails validation when payload is tampered", async () => {
    const { createHash } = await import("node:crypto");
    const relative = "backups/files-test.tar.gz";
    const absolute = path.join(storage, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const payload = Buffer.from("good-bytes");
    await fs.writeFile(absolute, payload);
    const checksum = createHash("sha256").update(payload).digest("hex");

    prismaMock.backupRecord.findUnique.mockResolvedValue({
      id: "bak2",
      type: "FILES",
      status: "COMPLETED",
      filePath: relative,
      checksumSha256: checksum,
      note: null,
      completedAt: new Date(),
      teamId: null,
    });

    const mod = await import("../migration-package");
    const exported = await mod.exportMigrationPackage({
      backupId: "bak2",
      projectRoot: tmp,
    });

    // tamper payload
    await fs.writeFile(
      path.join(exported.absoluteDir, exported.manifest.backup.payloadFileName),
      Buffer.from("evil"),
    );

    const validated = await mod.validateMigrationPackage(exported.packageRelativeDir, tmp);
    expect(validated.ok).toBe(false);
    expect(validated.checksumMatches).toBe(false);
    if (validated.cleanup) await validated.cleanup();
  });

  it("rejects a manifest payload path that escapes the package directory", async () => {
    const packageDir = path.join(storage, "migration-packages", "mig-unsafe1");
    await fs.mkdir(packageDir, { recursive: true });
    await fs.writeFile(path.join(storage, "outside.sql.gz"), "outside");
    await fs.writeFile(path.join(packageDir, "manifest.json"), JSON.stringify({
      version: 1,
      packageId: "mig-unsafe1",
      createdAt: new Date().toISOString(),
      source: { app: "VControlHub", hostname: "host", recordId: "r1", teamId: null },
      backup: {
        type: "DATABASE",
        originalFilePath: "backups/a.sql.gz",
        payloadFileName: "../../outside.sql.gz",
        fileSize: 7,
        checksumSha256: "0".repeat(64),
        note: null,
        completedAt: null,
      },
      instructions: { import: "", restore: "" },
    }));

    const mod = await import("../migration-package");
    await expect(mod.validateMigrationPackage("migration-packages/mig-unsafe1", tmp))
      .rejects.toThrow(/普通文件名/);
  });

  it("rejects symlink payloads even when their target is a regular file", async () => {
    const { createHash } = await import("node:crypto");
    const packageDir = path.join(storage, "migration-packages", "mig-symlink1");
    const outside = path.join(storage, "outside.sql.gz");
    const payload = Buffer.from("known outside payload");
    await fs.mkdir(packageDir, { recursive: true });
    await fs.writeFile(outside, payload);
    await fs.symlink(outside, path.join(packageDir, "payload.sql.gz"));
    await fs.writeFile(path.join(packageDir, "manifest.json"), JSON.stringify({
      version: 1,
      packageId: "mig-symlink1",
      createdAt: new Date().toISOString(),
      source: { app: "VControlHub", hostname: "host", recordId: "r1", teamId: null },
      backup: {
        type: "DATABASE",
        originalFilePath: "backups/a.sql.gz",
        payloadFileName: "payload.sql.gz",
        fileSize: payload.length,
        checksumSha256: createHash("sha256").update(payload).digest("hex"),
        note: null,
        completedAt: null,
      },
      instructions: { import: "", restore: "" },
    }));

    const mod = await import("../migration-package");
    const result = await mod.validateMigrationPackage("migration-packages/mig-symlink1", tmp);
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("payload is not a regular file: payload.sql.gz");
  });

  it("blocks another team's package while preserving legacy unscoped packages", async () => {
    const packageDir = path.join(storage, "migration-packages", "mig-team123");
    const payload = Buffer.from("team payload");
    const { createHash } = await import("node:crypto");
    await fs.mkdir(packageDir, { recursive: true });
    await fs.writeFile(path.join(packageDir, "payload.sql.gz"), payload);
    const manifest = {
      version: 1,
      packageId: "mig-team123",
      createdAt: new Date().toISOString(),
      source: { app: "VControlHub", hostname: "host", recordId: "r1", teamId: "team-a" },
      backup: {
        type: "DATABASE",
        originalFilePath: "backups/a.sql.gz",
        payloadFileName: "payload.sql.gz",
        fileSize: payload.length,
        checksumSha256: createHash("sha256").update(payload).digest("hex"),
        note: null,
        completedAt: null,
      },
      instructions: { import: "", restore: "" },
    };
    await fs.writeFile(path.join(packageDir, "manifest.json"), JSON.stringify(manifest));

    const mod = await import("../migration-package");
    await expect(mod.validateMigrationPackage(
      "migration-packages/mig-team123",
      tmp,
      { userId: "u2", roles: ["operator"], currentTeamId: "team-b" },
    )).rejects.toThrow(/其他团队/);

    manifest.source.teamId = null as unknown as string;
    await fs.writeFile(path.join(packageDir, "manifest.json"), JSON.stringify(manifest));
    await expect(mod.validateMigrationPackage(
      "migration-packages/mig-team123",
      tmp,
      { userId: "u2", roles: ["operator"], currentTeamId: "team-b" },
    )).resolves.toMatchObject({ ok: true });
  });
});

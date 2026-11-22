import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
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
    const payload = gzipSync("-- PostgreSQL database dump\nSELECT 1;\n-- PostgreSQL database dump complete\n");
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
    expect(exported.tarballRelativePath).toBe(exported.packageRelativeDir + ".tar.gz");
    expect(exported.packageId).toMatch(/^mig-/);
    expect(exported.manifest.backup.checksumSha256).toBe(checksum);

    if (process.platform !== "win32") expect((await fs.stat(path.join(storage, exported.tarballRelativePath!))).mode & 0o777).toBe(0o600);
    const digest = await import("@/lib/crypto/sha256-file");
    const read = vi.spyOn(digest, "sha256File").mockRejectedValueOnce(new Error("digest read failed"));
    try {
      await expect(mod.validateMigrationPackage(exported.tarballRelativePath!, tmp)).rejects.toThrow("digest read failed");
      expect((await fs.readdir(path.join(storage, "migration-packages"))).filter((name) => name.startsWith("import-"))).toEqual([]);
    } finally {
      read.mockRestore();
    }
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

  it("refuses to publish a changed backup and computes a digest for legacy records", async () => {
    const relative = "backups/legacy.sql.gz";
    await fs.mkdir(path.join(storage, "backups"));
    await fs.writeFile(path.join(storage, relative), gzipSync("-- PostgreSQL database dump\n-- PostgreSQL database dump complete\n"));
    const record = { id: "legacy", type: "DATABASE", status: "COMPLETED", filePath: relative };
    prismaMock.backupRecord.findUnique.mockResolvedValueOnce({ ...record, checksumSha256: "0".repeat(64) });
    const mod = await import("../migration-package");
    const options = { backupId: record.id, projectRoot: tmp };
    await expect(mod.exportMigrationPackage(options)).rejects.toThrow();
    expect(await fs.readdir(path.join(storage, "migration-packages"))).toEqual([]);
    prismaMock.backupRecord.findUnique.mockResolvedValueOnce({ ...record, checksumSha256: null });
    const result = await mod.exportMigrationPackage(options);
    expect((await mod.validateMigrationPackage(result.packageRelativeDir, tmp)).checksumMatches).toBe(true);
  });

  it("removes its copy when the import cannot be recorded, so a retry leaves one", async () => {
    // The copy was made, the record write failed: the copy stayed, unlisted,
    // and the retry made a second full copy.
    const { createHash } = await import("node:crypto");
    const relative = "backups/database-retry.sql.gz";
    const absolute = path.join(storage, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const payload = gzipSync("-- PostgreSQL database dump\nSELECT 2;\n-- PostgreSQL database dump complete\n");
    await fs.writeFile(absolute, payload);
    prismaMock.backupRecord.findUnique.mockResolvedValue({
      id: "bak2", type: "DATABASE", status: "COMPLETED", filePath: relative, fileSize: String(payload.length),
      checksumSha256: createHash("sha256").update(payload).digest("hex"), note: null, completedAt: new Date("2026-07-15T00:00:00.000Z"), teamId: "team1",
    });
    const mod = await import("../migration-package");
    const exported = await mod.exportMigrationPackage({ backupId: "bak2", projectRoot: tmp });
    const backupsNow = async () => (await fs.readdir(path.join(storage, "backups"))).filter((name) => name !== "database-retry.sql.gz");

    prismaMock.backupRecord.create.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(mod.importMigrationPackage({ packageRef: exported.packageRelativeDir, projectRoot: tmp })).rejects.toThrow("database unavailable");
    expect(await backupsNow()).toEqual([]);

    prismaMock.backupRecord.create.mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => ({ id: "imported2", ...data }));
    const imported = await mod.importMigrationPackage({ packageRef: exported.packageRelativeDir, projectRoot: tmp });
    expect(await backupsNow()).toEqual([path.basename(imported.filePath)]);
  });

  it("leaves no partial tarball behind when tar fails part-way", async () => {
    // tar stopped by its time limit (a large backup) had written the start of
    // the archive; the package was then listed as having a tarball, and that
    // truncated file is what got copied to the other host.
    const { createHash } = await import("node:crypto");
    const relative = "backups/database-big.sql.gz";
    const absolute = path.join(storage, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const payload = gzipSync("-- PostgreSQL database dump\nSELECT 3;\n-- PostgreSQL database dump complete\n");
    await fs.writeFile(absolute, payload);
    prismaMock.backupRecord.findUnique.mockResolvedValue({
      id: "bak3", type: "DATABASE", status: "COMPLETED", filePath: relative, fileSize: String(payload.length),
      checksumSha256: createHash("sha256").update(payload).digest("hex"), note: null, completedAt: new Date("2026-07-15T00:00:00.000Z"), teamId: "team1",
    });
    // Stands in for tar: writes the beginning of the output file, then fails.
    const failingTar = path.join(tmp, "failing-tar.sh");
    await fs.writeFile(failingTar, '#!/bin/sh\nprintf "partial" > "$2"\nexit 2\n', { mode: 0o755 });
    vi.doMock("@/lib/runtime/tar-binary", () => ({ resolveLocalTarBinary: () => failingTar }));

    const mod = await import("../migration-package");
    const exported = await mod.exportMigrationPackage({ backupId: "bak3", projectRoot: tmp });

    await expect(fs.access(path.join(storage, `${exported.packageRelativeDir}.tar.gz`))).rejects.toMatchObject({ code: "ENOENT" });
    expect(exported.tarballRelativePath).toBeNull();
    // The directory package is complete and is what the list offers.
    const listed = (await mod.listMigrationPackages(tmp)).find((entry) => entry.packageId === exported.packageId);
    expect(listed).toMatchObject({ hasTarball: false, type: "DATABASE" });
    vi.doUnmock("@/lib/runtime/tar-binary");
  });

  it("fails validation when payload is tampered", async () => {
    const { createHash } = await import("node:crypto");
    const relative = "backups/files-test.tar.gz";
    const absolute = path.join(storage, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.mkdir(path.join(tmp, "uploads"));
    await fs.writeFile(path.join(tmp, "uploads", "file.txt"), "fixture");
    const payload = execFileSync("tar", ["-czf", "-", "-C", tmp, "uploads"]);
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

  it.skipIf(process.platform === "win32")("refuses a linked package directory, its ancestor, and a linked or non-file manifest", async () => {
    const mod = await import("../migration-package");
    const external = path.join(tmp, "external"), inner = path.join(external, "inner");
    await fs.mkdir(inner, { recursive: true });
    await fs.symlink(external, path.join(storage, "alias"));
    for (const ref of ["alias", "alias/inner"]) await expect(mod.resolveMigrationPackageDir(ref, tmp)).rejects.toThrow();
    const dir = path.join(storage, "plain");
    await fs.mkdir(dir);
    await fs.writeFile(path.join(external, "manifest.json"), "{}");
    await fs.symlink(path.join(external, "manifest.json"), path.join(dir, "manifest.json"));
    await expect(mod.readMigrationManifest(dir)).rejects.toThrow();
    await fs.unlink(path.join(dir, "manifest.json"));
    await fs.mkdir(path.join(dir, "manifest.json"));
    await expect(mod.readMigrationManifest(dir)).rejects.toThrow();
  });

  it("refuses to register a package with missing source, empty bytes or the wrong payload type", async () => {
    const { createHash } = await import("node:crypto");
    const mod = await import("../migration-package");
    const dir = path.join(storage, "invalid-package");
    await fs.mkdir(dir);
    const sql = gzipSync("-- PostgreSQL database dump\n-- PostgreSQL database dump complete\n");
    for (const invalid of ["source", "empty", "type"]) {
      const bytes = invalid === "empty" ? Buffer.alloc(0) : sql;
      const manifest = { version: 1, packageId: "mig-test123", createdAt: new Date().toISOString(),
        source: invalid === "source" ? undefined : { app: "VControlHub", recordId: "record", hostname: "test", teamId: null },
        instructions: { import: "", restore: "" }, backup: { originalFilePath: "backups/test", payloadFileName: "payload",
          type: invalid === "type" ? "FULL" : "DATABASE", note: null, completedAt: null,
          fileSize: bytes.length, checksumSha256: createHash("sha256").update(bytes).digest("hex") },
      };
      await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));
      await fs.writeFile(path.join(dir, "payload"), bytes);
      if (invalid === "type") await expect(mod.validateMigrationPackage(dir, tmp)).resolves.toMatchObject({ ok: false });
      else await expect(mod.validateMigrationPackage(dir, tmp)).rejects.toThrow();
      await expect(mod.importMigrationPackage({ packageRef: dir, projectRoot: tmp })).rejects.toThrow();
    }
    expect(prismaMock.backupRecord.create).not.toHaveBeenCalled();
  });

  it("blocks another team's package while preserving legacy unscoped packages", async () => {
    const packageDir = path.join(storage, "migration-packages", "mig-team123");
    const payload = gzipSync("-- PostgreSQL database dump\n-- PostgreSQL database dump complete\n");
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
    )).rejects.toThrow(/其他客户/);

    manifest.source.teamId = null as unknown as string;
    await fs.writeFile(path.join(packageDir, "manifest.json"), JSON.stringify(manifest));
    await expect(mod.validateMigrationPackage(
      "migration-packages/mig-team123",
      tmp,
      { userId: "u2", roles: ["operator"], currentTeamId: "team-b" },
    )).resolves.toMatchObject({ ok: true });
  });
});

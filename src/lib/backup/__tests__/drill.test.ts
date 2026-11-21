import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";


const mocks = vi.hoisted(() => ({ getBackupRecord: vi.fn(), runBackupCommand: vi.fn() }));
vi.mock("../service-crud", () => ({ getBackupRecord: mocks.getBackupRecord, createBackupRecord: vi.fn(), listBackupRecords: vi.fn(), updateBackupRecordStatus: vi.fn() }));
vi.mock("../command-runner", () => ({ runBackupCommand: mocks.runBackupCommand, backupCommandErrorMessage: (e: Error) => e.message }));
vi.mock("../offsite-uploader", () => ({ uploadBackupToOffsite: vi.fn() }));
vi.mock("@/lib/concurrency/advisory-lock", () => ({ acquireAdvisoryLock: vi.fn(), tryAcquireAdvisoryLock: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/config/env", () => ({ config: { app: { appDir: "" }, storage: { backupDir: "" } } }));

import { drillBackupRecord } from "../service-runtime";

describe("non-destructive backup drill", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("verifies checksum, gzip integrity and database format without restore", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "backup-drill-"));
    const backupDir = path.join(root, "backups");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(backupDir));
    // The gzip integrity + format probes run in-process (Node zlib), so the
    // artifact must be a real gzip stream carrying PostgreSQL SQL.
    const bytes = gzipSync(Buffer.from("-- PostgreSQL database dump\nSET statement_timeout = 0;\n-- PostgreSQL database dump complete\n"));
    await writeFile(path.join(backupDir, "database.sql.gz"), bytes);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    mocks.getBackupRecord.mockResolvedValue({ id: "b1", type: "DATABASE", status: "COMPLETED", filePath: "database.sql.gz", checksumSha256: checksum });
    mocks.runBackupCommand.mockResolvedValue({ stdout: "", stderr: "" });
    const report = await drillBackupRecord({ id: "b1", projectRoot: root });
    expect(report.safe).toBe(true);
    expect(report.checksum.matched).toBe(true);
    expect(report.checks.map((check) => check.name)).toEqual(["artifact", "sha256", "gzip", "database-format"]);
    // No shell pipeline: the database drill stays entirely in-process.
    expect(mocks.runBackupCommand).not.toHaveBeenCalled();
    expect(mocks.runBackupCommand).not.toHaveBeenCalledWith(expect.objectContaining({ args: expect.arrayContaining(["scripts/restore-db.sh"]) }));
  });

  it("rejects checksum mismatches before probing the archive", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "backup-drill-bad-"));
    const backupDir = path.join(root, "backups");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(backupDir));
    await writeFile(path.join(backupDir, "files.tar.gz"), "bad");
    mocks.getBackupRecord.mockResolvedValue({ id: "b2", type: "FILES", status: "COMPLETED", filePath: "files.tar.gz", checksumSha256: "0".repeat(64) });
    await expect(drillBackupRecord({ id: "b2", projectRoot: root })).rejects.toThrow("校验和验证失败");
    expect(mocks.runBackupCommand).not.toHaveBeenCalled();
  });

  it("reports a backup file that is no longer on disk as such", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "backup-drill-missing-"));
    mocks.getBackupRecord.mockResolvedValue({ id: "b4", type: "DATABASE", status: "COMPLETED", filePath: "gone.sql.gz", checksumSha256: "0".repeat(64) });
    await expect(drillBackupRecord({ id: "b4", projectRoot: root })).rejects.toThrow("磁盘上找不到备份产物文件");
  });

  it("validates regular FILES members and rejects incomplete SQL in DATABASE and FULL archives", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "backup-drill-contract-"));
    const { mkdir, rm } = await import("node:fs/promises");
    const backupDir = path.join(root, "backups");
    await mkdir(backupDir);
    const drill = async (type: string, name: string, bytes: Buffer) => {
      await writeFile(path.join(backupDir, name), bytes);
      mocks.getBackupRecord.mockResolvedValue({ id: "contract", type, status: "COMPLETED", filePath: name, checksumSha256: createHash("sha256").update(bytes).digest("hex") });
      return drillBackupRecord({ id: "contract", projectRoot: root });
    };
    try {
      await writeFile(path.join(root, "file.txt"), "fixture");
      const tar = (member: string) => execFileSync("tar", ["-czf", "-", "-C", root, member]);
      const valid = await drill("FILES", "files.tar.gz", tar("file.txt"));
      expect(valid.checks.map((c) => c.name)).toEqual(["artifact", "sha256", "gzip", "archive-index"]);
      const incomplete = gzipSync("-- PostgreSQL database dump\n");
      await expect(drill("DATABASE", "bad.sql.gz", incomplete)).rejects.toThrow("completion marker");
      await writeFile(path.join(root, "database.sql.gz"), incomplete);
      await expect(drill("FULL", "full.tar.gz", tar("database.sql.gz"))).rejects.toThrow("completion marker");
      if (process.platform !== "win32") {
        await import("node:fs/promises").then(({ symlink }) => symlink("file.txt", path.join(root, "link")));
        await expect(drill("FILES", "link.tar.gz", tar("link"))).rejects.toThrow("links and special files");
      }
      expect(mocks.runBackupCommand).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

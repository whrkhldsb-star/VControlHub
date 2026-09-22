import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveLocalTarBinary } from "@/lib/runtime/tar-binary";

const mocks = vi.hoisted(() => ({ getBackupRecord: vi.fn(), runBackupCommand: vi.fn() }));
vi.mock("../service-crud", () => ({ getBackupRecord: mocks.getBackupRecord, createBackupRecord: vi.fn(), listBackupRecords: vi.fn(), updateBackupRecordStatus: vi.fn() }));
vi.mock("../command-runner", () => ({ runBackupCommand: mocks.runBackupCommand, backupCommandErrorMessage: (e: Error) => e.message }));
vi.mock("../offsite-uploader", () => ({ uploadBackupToOffsite: vi.fn() }));
vi.mock("@/lib/concurrency/advisory-lock", () => ({ acquireAdvisoryLock: vi.fn() }));
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
    const bytes = gzipSync(Buffer.from("-- PostgreSQL database dump\nSET statement_timeout = 0;\n"));
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

  it("uses tar -tzf archive argv without -- as filename for FILES drills", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "backup-drill-files-"));
    const backupDir = path.join(root, "backups");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(backupDir));
    // Real gzip wrapper so the in-process integrity probe passes; the tar
    // listing itself stays mocked.
    const bytes = gzipSync(Buffer.from("files-archive-placeholder"));
    const archiveRel = "files.tar.gz";
    const archiveAbs = path.join(backupDir, archiveRel);
    await writeFile(archiveAbs, bytes);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    mocks.getBackupRecord.mockResolvedValue({
      id: "b3",
      type: "FILES",
      status: "COMPLETED",
      filePath: archiveRel,
      checksumSha256: checksum,
    });
    mocks.runBackupCommand.mockImplementation(async (input: { file: string; args: string[] }) => {
      if (input.file === resolveLocalTarBinary()) {
        expect(input.args).toEqual(["-tzf", archiveAbs]);
        return { stdout: "./\na.txt\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });
    const report = await drillBackupRecord({ id: "b3", projectRoot: root });
    expect(report.checks.map((c) => c.name)).toEqual(["artifact", "sha256", "gzip", "archive-index"]);
    expect(mocks.runBackupCommand).toHaveBeenCalledWith(
      expect.objectContaining({ file: resolveLocalTarBinary(), args: ["-tzf", archiveAbs] }),
    );
    // Regression: never invoke shell form that treats `--` as the archive name.
    expect(mocks.runBackupCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({
        file: "bash",
        args: expect.arrayContaining([expect.stringContaining("tar -tzf --")]),
      }),
    );
  });
});

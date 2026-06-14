import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const mockedModule = {
    ...actual,
    execFile: execFileMock,
  };

  return {
    __esModule: true,
    ...mockedModule,
    default: mockedModule,
  };
});

import { backupCommandErrorMessage, isMissingBackupBinaryError, runBackupCommand } from "../command-runner";

describe("backup command-runner adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("runBackupCommand", () => {
    it("forwards file, args, and merged options to execFile and resolves with stdout/stderr", async () => {
      execFileMock.mockImplementation((_file: unknown, _args: unknown, _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
        cb(null, { stdout: "ok-stdout", stderr: "ok-stderr" });
      });

      const result = await runBackupCommand({
        file: "bash",
        args: ["deploy/backup.sh", "--full", "/var/backups/x/backups/full.tar.gz"],
        options: { cwd: "/opt/app", env: { ...process.env, APP_DIR: "/opt/app" } },
      });

      expect(result).toEqual({ stdout: "ok-stdout", stderr: "ok-stderr" });
      expect(execFileMock).toHaveBeenCalledTimes(1);
      const [file, args, opts] = execFileMock.mock.calls[0] as [string, string[], Record<string, unknown>];
      expect(file).toBe("bash");
      expect(args).toEqual(["deploy/backup.sh", "--full", "/var/backups/x/backups/full.tar.gz"]);
      expect(opts.cwd).toBe("/opt/app");
      expect(opts.env).toMatchObject({ APP_DIR: "/opt/app" });
      expect(opts.timeout).toBe(30 * 60 * 1000);
      expect(opts.maxBuffer).toBe(1024 * 1024);
    });

    it("applies the documented default 30-minute timeout and 1MB maxBuffer", async () => {
      execFileMock.mockImplementation((_file: unknown, _args: unknown, _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
        cb(null, { stdout: "", stderr: "" });
      });

      await runBackupCommand({ file: "tar", args: ["-xzf", "x", "-C", "y"] });

      const opts = execFileMock.mock.calls[0]![2] as Record<string, unknown>;
      expect(opts.timeout).toBe(30 * 60 * 1000);
      expect(opts.maxBuffer).toBe(1024 * 1024);
    });

    it("lets callers override the default timeout when restore or sync needs a shorter window", async () => {
      execFileMock.mockImplementation((_file: unknown, _args: unknown, _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
        cb(null, { stdout: "", stderr: "" });
      });

      await runBackupCommand({ file: "bash", args: ["scripts/restore-db.sh", "x"], options: { timeout: 5 * 60 * 1000 } });

      const opts = execFileMock.mock.calls[0]![2] as Record<string, unknown>;
      expect(opts.timeout).toBe(5 * 60 * 1000);
      expect(opts.maxBuffer).toBe(1024 * 1024);
    });

    it("rejects with the raw execFile error so callers can classify failure category", async () => {
      const boom = Object.assign(new Error("tar failed"), { code: "EIO" });
      execFileMock.mockImplementation((_file: unknown, _args: unknown, _opts: unknown, cb: (err: Error | null) => void) => {
        cb(boom);
      });

      await expect(
        runBackupCommand({ file: "bash", args: ["deploy/backup.sh", "--files", "/tmp/x.tar.gz"], options: { cwd: "/opt/app" } }),
      ).rejects.toBe(boom);
    });

    it("propagates ENOENT without rewriting it, so the error-message helper can format it", async () => {
      const enoent = Object.assign(new Error("spawn bash ENOENT"), { code: "ENOENT", errno: -2, syscall: "spawn bash" });
      execFileMock.mockImplementation((_file: unknown, _args: unknown, _opts: unknown, cb: (err: Error | null) => void) => {
        cb(enoent);
      });

      await expect(
        runBackupCommand({ file: "bash", args: ["deploy/backup.sh", "/tmp/x.tar.gz"] }),
      ).rejects.toBe(enoent);
    });
  });

  describe("isMissingBackupBinaryError", () => {
    it("returns true when the error is an ENOENT spawn failure", () => {
      const err = Object.assign(new Error("spawn bash ENOENT"), { code: "ENOENT" });
      expect(isMissingBackupBinaryError(err)).toBe(true);
    });

    it("returns false for non-ENOENT errors (permission denied, IO, timeout)", () => {
      const eacces = Object.assign(new Error("permission denied"), { code: "EACCES" });
      const timeout = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
      const generic = new Error("tar failed");
      expect(isMissingBackupBinaryError(eacces)).toBe(false);
      expect(isMissingBackupBinaryError(timeout)).toBe(false);
      expect(isMissingBackupBinaryError(generic)).toBe(false);
    });

    it("returns false for null, undefined, and non-object values", () => {
      expect(isMissingBackupBinaryError(null)).toBe(false);
      expect(isMissingBackupBinaryError(undefined)).toBe(false);
      expect(isMissingBackupBinaryError("ENOENT")).toBe(false);
      expect(isMissingBackupBinaryError(42)).toBe(false);
    });
  });

  describe("backupCommandErrorMessage", () => {
    it("returns the documented missing-binary message when the error code is ENOENT", () => {
      const err = Object.assign(new Error("spawn bash ENOENT"), { code: "ENOENT" });
      expect(backupCommandErrorMessage(err)).toBe("bash 未安装或不在 PATH，请联系管理员安装 bash 或修复 PATH 后重试。");
    });

    it("returns the original Error message for any non-ENOENT error", () => {
      expect(backupCommandErrorMessage(new Error("tar failed"))).toBe("tar failed");
      expect(backupCommandErrorMessage(new Error("permission denied"))).toBe("permission denied");
    });

    it("falls back to a generic backup-execution message for non-Error values", () => {
      expect(backupCommandErrorMessage(null)).toBe("备份执行失败");
      expect(backupCommandErrorMessage(undefined)).toBe("备份执行失败");
      expect(backupCommandErrorMessage("boom")).toBe("备份执行失败");
    });
  });
});

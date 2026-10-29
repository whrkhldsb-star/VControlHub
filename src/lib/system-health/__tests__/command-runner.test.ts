import {
  HEALTH_CHECK_DEFAULT_TIMEOUT_MS,
  runHealthCheckCommand,
} from "@/lib/system-health/command-runner";
import { afterEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
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

type ExecFileCallback = (error: Error | null, stdout?: string, stderr?: string) => void;

describe("lib/system-health/command-runner", () => {
  afterEach(() => {
    execFileMock.mockReset();
  });

  it("returns what a command printed when it exited non-zero by itself (systemctl is-active exits 3 for a stopped unit)", async () => {
    // The mock used to hand back `cb(null, "inactive")`, which the real systemctl never does: it exits 3 and
    // Node reports that as an error, so a stopped service read as "status temporarily unreadable".
    execFileMock.mockImplementationOnce(
      ((_file: string, _args: string[], _options: unknown, cb: ExecFileCallback) => {
        cb(Object.assign(new Error("Command failed"), { code: 3, killed: false }), "inactive\n", "");
      }) as never,
    );
    expect(await runHealthCheckCommand({ file: "systemctl", args: ["is-active", "x.service"] })).toBe("inactive");
  });

  it("still returns null when the command never answered: it failed silently, was killed, or is missing", async () => {
    const failWith = (error: Error, stdout: string) => execFileMock.mockImplementationOnce(
      ((_f: string, _a: string[], _o: unknown, cb: ExecFileCallback) => { cb(error, stdout, ""); }) as never,
    );
    failWith(Object.assign(new Error("exit 128"), { code: 128, killed: false }), "");
    expect(await runHealthCheckCommand({ file: "git", args: ["rev-parse", "HEAD"] })).toBeNull();
    failWith(Object.assign(new Error("timeout"), { code: null, killed: true, signal: "SIGKILL" }), "partial output");
    expect(await runHealthCheckCommand({ file: "git", args: ["ls-remote"] })).toBeNull();
    failWith(Object.assign(new Error("spawn systemctl ENOENT"), { code: "ENOENT" }), "");
    expect(await runHealthCheckCommand({ file: "systemctl", args: ["is-active", "x"] })).toBeNull();
  });

  it("returns trimmed stdout on success", async () => {
    execFileMock.mockImplementationOnce(
      ((_file: string, _args: string[], _options: unknown, cb: ExecFileCallback) => {
        cb(null, "active\n", "");
      }) as never,
    );
    expect(await runHealthCheckCommand({ file: "systemctl", args: ["is-active", "x.service"] })).toBe("active");
    expect(execFileMock).toHaveBeenCalledWith(
      "systemctl",
      ["is-active", "x.service"],
      expect.objectContaining({ encoding: "utf8", timeout: HEALTH_CHECK_DEFAULT_TIMEOUT_MS }),
      expect.any(Function),
    );
  });

  it("returns null on ENOENT (missing binary)", async () => {
    execFileMock.mockImplementationOnce(
      ((_file: string, _args: string[], _options: unknown, cb: ExecFileCallback) => {
        const err: NodeJS.ErrnoException = new Error("spawn systemctl ENOENT");
        err.code = "ENOENT";
        cb(err, "", "");
      }) as never,
    );
    expect(await runHealthCheckCommand({ file: "systemctl", args: ["is-active", "x.service"] })).toBeNull();
  });

  it("returns null on non-zero exit", async () => {
    execFileMock.mockImplementationOnce(
      ((_file: string, _args: string[], _options: unknown, cb: ExecFileCallback) => {
        cb(new Error("Command failed with exit code 3"), "", "");
      }) as never,
    );
    expect(await runHealthCheckCommand({ file: "git", args: ["rev-parse", "--short", "HEAD"] })).toBeNull();
  });

  it("returns null on timeout", async () => {
    execFileMock.mockImplementationOnce(
      ((_file: string, _args: string[], _options: unknown, cb: ExecFileCallback) => {
        const err = new Error("Command timed out");
        (err as NodeJS.ErrnoException).code = "ETIMEDOUT";
        cb(err, "", "");
      }) as never,
    );
    expect(await runHealthCheckCommand({ file: "git", args: ["-C", "/tmp", "ls-remote", "origin", "main"] })).toBeNull();
  });

  it("respects caller-provided timeout override", async () => {
    execFileMock.mockImplementationOnce(
      ((_file: string, _args: string[], _options: unknown, cb: ExecFileCallback) => {
        cb(null, "abc1234", "");
      }) as never,
    );
    await runHealthCheckCommand({ file: "git", args: ["-C", "/tmp", "rev-parse", "--short", "HEAD"], options: { timeoutMs: 1500 } });
    expect(execFileMock).toHaveBeenCalledWith(
      "git",
      ["-C", "/tmp", "rev-parse", "--short", "HEAD"],
      expect.objectContaining({ timeout: 1500 }),
      expect.any(Function),
    );
  });

  it("exposes a sensible default timeout constant", () => {
    expect(HEALTH_CHECK_DEFAULT_TIMEOUT_MS).toBe(5000);
  });

  it("passes an empty arg list through", async () => {
    execFileMock.mockImplementationOnce(
      ((_file: string, _args: string[], _options: unknown, cb: ExecFileCallback) => {
        cb(null, "", "");
      }) as never,
    );
    expect(await runHealthCheckCommand({ file: "true", args: [] })).toBe("");
  });
});

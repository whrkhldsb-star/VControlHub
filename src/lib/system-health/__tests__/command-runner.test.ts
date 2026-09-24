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

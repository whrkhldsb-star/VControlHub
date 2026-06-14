import {
  HEALTH_CHECK_DEFAULT_TIMEOUT_MS,
  runHealthCheckCommand,
} from "@/lib/system-health/command-runner";
import { afterEach, describe, expect, it, vi } from "vitest";

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  const mockedModule = {
    ...actual,
    execFileSync: execFileSyncMock,
  };
  return {
    __esModule: true,
    ...mockedModule,
    default: mockedModule,
  };
});

describe("lib/system-health/command-runner", () => {
  afterEach(() => {
    execFileSyncMock.mockReset();
  });

  it("returns trimmed stdout on success", () => {
    execFileSyncMock.mockReturnValueOnce("active\n" as never);
    expect(runHealthCheckCommand({ file: "systemctl", args: ["is-active", "x.service"] })).toBe("active");
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "systemctl",
      ["is-active", "x.service"],
      expect.objectContaining({ encoding: "utf8", timeout: HEALTH_CHECK_DEFAULT_TIMEOUT_MS }),
    );
  });

  it("returns null on ENOENT (missing binary)", () => {
    execFileSyncMock.mockImplementationOnce(() => {
      const err: NodeJS.ErrnoException = new Error("spawn systemctl ENOENT");
      err.code = "ENOENT";
      throw err;
    });
    expect(runHealthCheckCommand({ file: "systemctl", args: ["is-active", "x.service"] })).toBeNull();
  });

  it("returns null on non-zero exit", () => {
    execFileSyncMock.mockImplementationOnce(() => {
      throw new Error("Command failed with exit code 3");
    });
    expect(runHealthCheckCommand({ file: "git", args: ["rev-parse", "--short", "HEAD"] })).toBeNull();
  });

  it("returns null on timeout", () => {
    execFileSyncMock.mockImplementationOnce(() => {
      const err = new Error("Command timed out");
      (err as NodeJS.ErrnoException).code = "ETIMEDOUT";
      throw err;
    });
    expect(runHealthCheckCommand({ file: "git", args: ["-C", "/tmp", "ls-remote", "origin", "main"] })).toBeNull();
  });

  it("respects caller-provided timeout override", () => {
    execFileSyncMock.mockReturnValueOnce("abc1234" as never);
    runHealthCheckCommand({ file: "git", args: ["-C", "/tmp", "rev-parse", "--short", "HEAD"], options: { timeoutMs: 1500 } });
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "git",
      ["-C", "/tmp", "rev-parse", "--short", "HEAD"],
      expect.objectContaining({ timeout: 1500 }),
    );
  });

  it("exposes a sensible default timeout constant", () => {
    expect(HEALTH_CHECK_DEFAULT_TIMEOUT_MS).toBe(5000);
  });

  it("passes an empty arg list through", () => {
    execFileSyncMock.mockReturnValueOnce("" as never);
    expect(runHealthCheckCommand({ file: "true", args: [] })).toBe("");
  });
});

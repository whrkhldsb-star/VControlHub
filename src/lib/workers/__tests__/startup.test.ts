import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TR-001 T13c: the startup orchestrator decides whether to start
 * workers in the current process and registers a SIGTERM/SIGINT
 * handler for graceful shutdown. These tests cover:
 *   - skip when VITEST=true / NODE_ENV=test / VCONTROLHUB_WORKERS_DISABLED=true
 *   - register the complete worker fleet in prod
 *   - idempotent: second call is a no-op
 *   - SIGTERM triggers stopAllWorkers
 *   - failed workers are surfaced in the return value
 */
const {
  startAllWorkersMock,
  stopAllWorkersMock,
  startRuntimeHeartbeatMock,
  stopRuntimeHeartbeatMock,
  mockCreateLogger,
} = vi.hoisted(() => ({
  startAllWorkersMock: vi.fn(),
  stopAllWorkersMock: vi.fn(),
  startRuntimeHeartbeatMock: vi.fn(),
  stopRuntimeHeartbeatMock: vi.fn(),
  mockCreateLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("@/lib/workers/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workers/registry")>();
  return {
    ...actual,
    startAllWorkers: startAllWorkersMock,
    stopAllWorkers: stopAllWorkersMock,
  };
});

vi.mock("@/lib/logging", () => ({
  createLogger: mockCreateLogger,
}));

vi.mock("@/lib/workers/runtime-heartbeat", () => ({
  startWorkerRuntimeHeartbeat: startRuntimeHeartbeatMock,
  stopWorkerRuntimeHeartbeat: stopRuntimeHeartbeatMock,
}));

import {
  _resetWorkerLifecycleForTests,
  startWorkerLifecycle,
  stopWorkerLifecycle,
} from "@/lib/workers/startup";

// `process.env.NODE_ENV` is typed readonly; runtime mutation is fine
// for tests. Helper casts avoid `ts-expect-error` noise without
// disabling the linter for the file.
function setEnv(key: string, value: string | undefined): void {
  const env = process.env as unknown as Record<string, string | undefined>;
  if (value === undefined) delete env[key];
  else env[key] = value;
}

const ALL_STARTED = [
  "alert-evaluation",
  "backup",
  "command-execution",
  "command-maintenance",
  "download-execution",
  "quick-service",
  "scheduled-task",
  "sftp-sync",
] as const;

beforeEach(() => {
  _resetWorkerLifecycleForTests();
  startAllWorkersMock.mockReset();
  stopAllWorkersMock.mockReset();
  startRuntimeHeartbeatMock.mockReset().mockResolvedValue(undefined);
  stopRuntimeHeartbeatMock.mockReset().mockResolvedValue(undefined);
  startAllWorkersMock.mockResolvedValue({
    started: ALL_STARTED,
    failed: [],
  });
  mockCreateLogger.mockClear();
  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGINT");
  // Default to a "production-like" environment for the test; individual
  // tests override to exercise the skip branches.
  setEnv("VITEST", undefined);
  setEnv("NODE_ENV", "production");
  setEnv("VCONTROLHUB_WORKERS_DISABLED", undefined);
});

afterEach(() => {
  _resetWorkerLifecycleForTests();
  setEnv("VITEST", undefined);
  setEnv("NODE_ENV", undefined);
  setEnv("VCONTROLHUB_WORKERS_DISABLED", undefined);
  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGINT");
});

describe("startWorkerLifecycle", () => {
  it("skips startup when VITEST=true", async () => {
    setEnv("VITEST", "true");
    const result = await startWorkerLifecycle();
    expect(result).toMatchObject({ skipped: true, reason: "test" });
    expect(startAllWorkersMock).not.toHaveBeenCalled();
  });

  it("skips startup when NODE_ENV=test", async () => {
    setEnv("NODE_ENV", "test");
    const result = await startWorkerLifecycle();
    expect(result).toMatchObject({ skipped: true, reason: "test" });
    expect(startAllWorkersMock).not.toHaveBeenCalled();
  });

  it("skips startup when VCONTROLHUB_WORKERS_DISABLED=true", async () => {
    setEnv("VCONTROLHUB_WORKERS_DISABLED", "true");
    const result = await startWorkerLifecycle();
    expect(result).toMatchObject({ skipped: true, reason: "disabled" });
    expect(startAllWorkersMock).not.toHaveBeenCalled();
  });

  it("starts every worker when not in test/disabled mode", async () => {
    const result = await startWorkerLifecycle();
    expect(result.skipped).toBe(false);
    expect(startAllWorkersMock).toHaveBeenCalledTimes(1);
    expect(startRuntimeHeartbeatMock).toHaveBeenCalledTimes(1);
    expect(result.failed).toEqual([]);
  });

  it("is idempotent — second call returns already-started without re-running", async () => {
    const first = await startWorkerLifecycle();
    const second = await startWorkerLifecycle();
    expect(first.skipped).toBe(false);
    expect(second.skipped).toBe(true);
    expect(second.reason).toBe("already-started");
    expect(startAllWorkersMock).toHaveBeenCalledTimes(1);
  });

  it("fails fast and rolls back when any worker cannot start", async () => {
    startAllWorkersMock.mockResolvedValueOnce({
      started: ["alert-evaluation"],
      failed: [{ id: "backup", error: "disk full" }],
    });

    await expect(startWorkerLifecycle()).rejects.toThrow("backup");
    expect(stopAllWorkersMock).toHaveBeenCalledTimes(1);
    expect(startRuntimeHeartbeatMock).not.toHaveBeenCalled();
  });

  it("fails startup when runtime monitoring cannot be registered", async () => {
    startRuntimeHeartbeatMock.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(startWorkerLifecycle()).rejects.toThrow("database unavailable");
    expect(stopAllWorkersMock).toHaveBeenCalledTimes(1);
    expect(stopRuntimeHeartbeatMock).toHaveBeenCalledTimes(1);
  });
});

describe("stopWorkerLifecycle", () => {
  it("stops workers and records the stopped runtime", async () => {
    await startWorkerLifecycle();
    await stopWorkerLifecycle();
    expect(stopAllWorkersMock).toHaveBeenCalledTimes(1);
    expect(stopRuntimeHeartbeatMock).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent shutdown callers into one stop operation", async () => {
    let releaseHeartbeat!: () => void;
    stopRuntimeHeartbeatMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
      releaseHeartbeat = resolve;
    }));
    await startWorkerLifecycle();

    const first = stopWorkerLifecycle();
    const second = stopWorkerLifecycle();
    expect(second).toBe(first);
    expect(stopAllWorkersMock).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(stopRuntimeHeartbeatMock).toHaveBeenCalledTimes(1));
    releaseHeartbeat();
    await Promise.all([first, second]);
    expect(stopRuntimeHeartbeatMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing after the lifecycle has already stopped", async () => {
    await startWorkerLifecycle();
    await stopWorkerLifecycle();
    await stopWorkerLifecycle();
    expect(stopAllWorkersMock).toHaveBeenCalledTimes(1);
    expect(stopRuntimeHeartbeatMock).toHaveBeenCalledTimes(1);
  });
});

describe("SIGTERM handler", () => {
  it("invokes stopAllWorkers when SIGTERM is received", async () => {
    await startWorkerLifecycle();
    expect(stopAllWorkersMock).not.toHaveBeenCalled();
    process.emit("SIGTERM");
    // Yield to let the once-handler fire.
    await vi.waitFor(() => expect(stopRuntimeHeartbeatMock).toHaveBeenCalledTimes(1));
    expect(stopAllWorkersMock).toHaveBeenCalledTimes(1);
  });

  it("registers handler only once across consecutive start calls", async () => {
    await startWorkerLifecycle();
    // Without a reset, a second call should be a no-op for handler
    // installation (state.installed === true) and thus stopAllWorkers
    // fires exactly once on SIGTERM.
    await startWorkerLifecycle();
    process.emit("SIGTERM");
    await Promise.resolve();
    expect(stopAllWorkersMock).toHaveBeenCalledTimes(1);
  });
});

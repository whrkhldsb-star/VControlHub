import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TR-001 T13c: the startup orchestrator decides whether to start
 * workers in the current process and registers a SIGTERM/SIGINT
 * handler for graceful shutdown. These tests cover:
 *   - skip when VITEST=true / NODE_ENV=test / VCONTROLHUB_WORKERS_DISABLED=true
 *   - register all 9 workers in prod
 *   - idempotent: second call is a no-op
 *   - SIGTERM triggers stopAllWorkers
 *   - failed workers are surfaced in the return value
 */
const { startAllWorkersMock, stopAllWorkersMock, mockCreateLogger } = vi.hoisted(() => ({
  startAllWorkersMock: vi.fn(),
  stopAllWorkersMock: vi.fn(),
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

  it("surfaces failed workers from startAllWorkers", async () => {
    startAllWorkersMock.mockResolvedValueOnce({
      started: ["alert-evaluation"],
      failed: [{ id: "backup", error: "disk full" }],
    });
    const result = await startWorkerLifecycle();
    expect(result.failed).toEqual([{ id: "backup", error: "disk full" }]);
  });
});

describe("stopWorkerLifecycle", () => {
  it("calls stopAllWorkers", () => {
    stopWorkerLifecycle();
    expect(stopAllWorkersMock).toHaveBeenCalledTimes(1);
  });
});

describe("SIGTERM handler", () => {
  it("invokes stopAllWorkers when SIGTERM is received", async () => {
    await startWorkerLifecycle();
    expect(stopAllWorkersMock).not.toHaveBeenCalled();
    process.emit("SIGTERM");
    // Yield to let the once-handler fire.
    await Promise.resolve();
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

import { beforeEach, describe, expect, it, vi } from "vitest";

const { recoverStaleRunningCommandRequestsMock, infoMock, warnMock, errorMock } = vi.hoisted(() => ({
  recoverStaleRunningCommandRequestsMock: vi.fn(),
  infoMock: vi.fn(),
  warnMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("./service", () => ({
  recoverStaleRunningCommandRequests: recoverStaleRunningCommandRequestsMock,
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({
    info: infoMock,
    warn: warnMock,
    error: errorMock,
  }),
}));

import { startCommandMaintenanceWorker, stopCommandMaintenanceWorkerForTests } from "./worker";

describe("command maintenance worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    delete process.env.COMMAND_RECONCILE_INTERVAL_MS;
    recoverStaleRunningCommandRequestsMock.mockResolvedValue({ recovered: 0 });
    stopCommandMaintenanceWorkerForTests();
  });

  it("starts once and reconciles stale running commands on startup and interval", async () => {
    process.env.COMMAND_RECONCILE_INTERVAL_MS = "1000";
    recoverStaleRunningCommandRequestsMock.mockResolvedValueOnce({ recovered: 1 }).mockResolvedValue({ recovered: 0 });

    startCommandMaintenanceWorker();
    startCommandMaintenanceWorker();

    expect(infoMock).toHaveBeenCalledTimes(1);
    expect(recoverStaleRunningCommandRequestsMock).toHaveBeenCalledTimes(1);
    await vi.runOnlyPendingTimersAsync();
    expect(recoverStaleRunningCommandRequestsMock).toHaveBeenCalledTimes(2);
    expect(warnMock).toHaveBeenCalledWith("Recovered stale command requests", { reason: "startup", recovered: 1 });
  });

  it("skips overlapping reconciliation ticks while a previous tick is still running", async () => {
    process.env.COMMAND_RECONCILE_INTERVAL_MS = "1000";
    let release!: () => void;
    recoverStaleRunningCommandRequestsMock.mockReturnValue(new Promise((resolve) => {
      release = () => resolve({ recovered: 0 });
    }));

    startCommandMaintenanceWorker();
    await vi.advanceTimersByTimeAsync(1000);

    expect(recoverStaleRunningCommandRequestsMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledWith(
      "Skipping command reconciliation because a previous tick is still running",
      { reason: "interval" },
    );

    release();
    await vi.runOnlyPendingTimersAsync();
  });
});

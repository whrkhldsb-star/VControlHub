import { beforeEach, describe, expect, it, vi } from "vitest";

const { recoverStaleRunningCommandRequestsMock, recoverQueuedApprovedCommandRequestsMock, getRuntimeSettingNumberMock, infoMock, warnMock, errorMock } = vi.hoisted(() => ({
  recoverStaleRunningCommandRequestsMock: vi.fn(),
  recoverQueuedApprovedCommandRequestsMock: vi.fn(),
  getRuntimeSettingNumberMock: vi.fn(),
  infoMock: vi.fn(),
  warnMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("./service", () => ({
  recoverStaleRunningCommandRequests: recoverStaleRunningCommandRequestsMock,
  recoverQueuedApprovedCommandRequests: recoverQueuedApprovedCommandRequestsMock,
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({
    info: infoMock,
    warn: warnMock,
    error: errorMock,
  }),
}));

vi.mock("@/lib/runtime-settings/service", () => ({
  getRuntimeSettingNumber: getRuntimeSettingNumberMock,
}));

import { startCommandMaintenanceWorker, stopCommandMaintenanceWorkerForTests } from "./worker";

describe("command maintenance worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    delete process.env.COMMAND_RECONCILE_INTERVAL_MS;
    getRuntimeSettingNumberMock.mockResolvedValue(1000);
    recoverStaleRunningCommandRequestsMock.mockResolvedValue({ recovered: 0 });
    recoverQueuedApprovedCommandRequestsMock.mockResolvedValue({ enqueued: 0 });
    stopCommandMaintenanceWorkerForTests();
  });

  it("starts once and reconciles stale running commands on startup and interval", async () => {
    process.env.COMMAND_RECONCILE_INTERVAL_MS = "1000";
    recoverStaleRunningCommandRequestsMock.mockResolvedValueOnce({ recovered: 1 }).mockResolvedValue({ recovered: 0 });

    await startCommandMaintenanceWorker();
    await startCommandMaintenanceWorker();
    await Promise.resolve();

    expect(infoMock).toHaveBeenCalledTimes(1);
    expect(recoverQueuedApprovedCommandRequestsMock).toHaveBeenCalledTimes(1);
    expect(recoverStaleRunningCommandRequestsMock).toHaveBeenCalledTimes(1);
    await vi.runOnlyPendingTimersAsync();
    expect(recoverQueuedApprovedCommandRequestsMock).toHaveBeenCalledTimes(2);
    expect(recoverStaleRunningCommandRequestsMock).toHaveBeenCalledTimes(2);
    expect(warnMock).toHaveBeenCalledWith("Recovered stale command requests", { reason: "startup", recovered: 1 });
  });

  it("logs recovered queued approved commands during maintenance ticks", async () => {
    recoverQueuedApprovedCommandRequestsMock.mockResolvedValueOnce({ enqueued: 2 }).mockResolvedValue({ enqueued: 0 });

    await startCommandMaintenanceWorker();
    await Promise.resolve();

    expect(recoverQueuedApprovedCommandRequestsMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledWith("Re-enqueued approved command requests", { reason: "startup", enqueued: 2 });
  });

  it("skips overlapping reconciliation ticks while a previous tick is still running", async () => {
    process.env.COMMAND_RECONCILE_INTERVAL_MS = "1000";
    let release!: () => void;
    recoverQueuedApprovedCommandRequestsMock.mockReturnValue(new Promise((resolve) => {
      release = () => resolve({ enqueued: 0 });
    }));
    recoverStaleRunningCommandRequestsMock.mockResolvedValue({ recovered: 0 });

    await startCommandMaintenanceWorker();
    await vi.advanceTimersByTimeAsync(1000);

    expect(recoverQueuedApprovedCommandRequestsMock).toHaveBeenCalledTimes(1);
    expect(recoverStaleRunningCommandRequestsMock).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalledWith(
      "Skipping command reconciliation because a previous tick is still running",
      { reason: "interval" },
    );

    release();
    await vi.runOnlyPendingTimersAsync();
  });
});

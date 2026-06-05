import { beforeEach, describe, expect, it, vi } from "vitest";

const { evaluateAlertsMock, infoMock, warnMock, errorMock } = vi.hoisted(() => ({
  evaluateAlertsMock: vi.fn(),
  infoMock: vi.fn(),
  warnMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("./service", () => ({
  evaluateAlerts: evaluateAlertsMock,
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({
    info: infoMock,
    warn: warnMock,
    error: errorMock,
  }),
}));

import { startAlertEvaluationWorker, stopAlertEvaluationWorkerForTests } from "./alert-worker";

describe("alert evaluation worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    evaluateAlertsMock.mockResolvedValue(undefined);
    stopAlertEvaluationWorkerForTests();
  });

  it("starts once (idempotent) and evaluates alerts on startup and interval", async () => {
    await startAlertEvaluationWorker();
    await startAlertEvaluationWorker();
    await Promise.resolve();

    expect(infoMock).toHaveBeenCalledTimes(1);
    expect(evaluateAlertsMock).toHaveBeenCalledTimes(1);

    await vi.runOnlyPendingTimersAsync();
    expect(evaluateAlertsMock).toHaveBeenCalledTimes(2);
  });

  it("swallows evaluation errors without throwing", async () => {
    evaluateAlertsMock.mockRejectedValueOnce(new Error("eval boom")).mockResolvedValue(undefined);

    await expect(startAlertEvaluationWorker()).resolves.toBeDefined();
    await Promise.resolve();
    await Promise.resolve();

    expect(errorMock).toHaveBeenCalled();
  });

  it("skips overlapping ticks while a previous evaluation is still running", async () => {
    let release!: () => void;
    evaluateAlertsMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = () => resolve();
      }),
    );

    await startAlertEvaluationWorker();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(evaluateAlertsMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledWith(
      "Skipping alert evaluation tick because a previous tick is still running",
      { reason: "interval" },
    );

    release();
    await vi.runOnlyPendingTimersAsync();
  });
});

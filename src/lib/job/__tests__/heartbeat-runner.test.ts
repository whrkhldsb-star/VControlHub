import { describe, expect, it, vi } from "vitest";

import { LeaseLostError, runWithLeaseHeartbeat } from "../heartbeat-runner";

describe("runWithLeaseHeartbeat", () => {
  it("treats heartbeat count=0 as lease loss after the run settles", async () => {
    vi.useFakeTimers();
    const heartbeat = vi.fn().mockResolvedValue({ count: 0 });
    const onHeartbeatFailure = vi.fn();
    let release!: () => void;
    const runPromise = new Promise<string>((resolve) => {
      release = () => resolve("done");
    });

    const resultPromise = runWithLeaseHeartbeat({
      jobId: "job-1",
      leaseMs: 30_000,
      heartbeat,
      onHeartbeatFailure,
      run: () => runPromise,
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(heartbeat).toHaveBeenCalled();
    expect(onHeartbeatFailure).toHaveBeenCalledWith(expect.any(LeaseLostError));
    release();
    await expect(resultPromise).rejects.toBeInstanceOf(LeaseLostError);
    vi.useRealTimers();
  });

  it("returns the run result when heartbeats keep ownership", async () => {
    const heartbeat = vi.fn().mockResolvedValue({ count: 1 });
    await expect(
      runWithLeaseHeartbeat({
        jobId: "job-2",
        leaseMs: 30_000,
        heartbeat,
        run: async () => "ok",
      }),
    ).resolves.toBe("ok");
  });

  it("aborts the run's signal the moment the lease is lost", async () => {
    vi.useFakeTimers();
    const heartbeat = vi.fn().mockResolvedValue({ count: 0 });
    let observedAborted = false;
    let release!: () => void;
    const runPromise = new Promise<string>((resolve) => {
      release = () => resolve("done");
    });

    const resultPromise = runWithLeaseHeartbeat({
      jobId: "job-3",
      leaseMs: 30_000,
      heartbeat,
      run: (signal) => {
        signal.addEventListener("abort", () => {
          observedAborted = signal.aborted;
        });
        return runPromise;
      },
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(observedAborted).toBe(true);
    release();
    await expect(resultPromise).rejects.toBeInstanceOf(LeaseLostError);
    vi.useRealTimers();
  });

  it("does not abort the signal on a clean run", async () => {
    const heartbeat = vi.fn().mockResolvedValue({ count: 1 });
    let sawAbort = false;
    await runWithLeaseHeartbeat({
      jobId: "job-4",
      leaseMs: 30_000,
      heartbeat,
      run: async (signal) => {
        sawAbort = signal.aborted;
        return "ok";
      },
    });
    expect(sawAbort).toBe(false);
  });

  it("aborts once and reports a rejected heartbeat without overlapping retries", async () => {
    vi.useFakeTimers();
    let rejectHeartbeat!: (error: Error) => void;
    const heartbeat = vi.fn(() => new Promise<never>((_, reject) => {
      rejectHeartbeat = reject;
    }));
    const onHeartbeatFailure = vi.fn();
    let release!: () => void;
    const runPromise = new Promise<string>((resolve) => {
      release = () => resolve("done");
    });

    const resultPromise = runWithLeaseHeartbeat({
      jobId: "job-5",
      leaseMs: 30_000,
      heartbeat,
      onHeartbeatFailure,
      run: (_signal) => runPromise,
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(heartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(heartbeat).toHaveBeenCalledTimes(1);

    const error = new Error("database unavailable");
    rejectHeartbeat(error);
    await vi.advanceTimersByTimeAsync(0);
    expect(onHeartbeatFailure).toHaveBeenCalledTimes(1);
    release();
    await expect(resultPromise).rejects.toBeInstanceOf(LeaseLostError);
    vi.useRealTimers();
  });
});

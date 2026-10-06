import { afterEach, describe, expect, it, vi } from "vitest";

import { LeaseLostError, runWithLeaseHeartbeat } from "../heartbeat-runner";

describe("runWithLeaseHeartbeat", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("aborts at lease expiry even when the database heartbeat never returns", async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    let release!: () => void;
    const operation = new Promise<string>((resolve) => { release = () => resolve("done"); });
    const heartbeat = vi.fn(() => new Promise<never>(() => undefined));
    const result = runWithLeaseHeartbeat({
      jobId: "stalled-database", leaseMs: 30_000, heartbeat,
      run: (value) => { signal = value; return operation; },
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_001);
    const abortedAtExpiry = signal.aborted;
    release();
    const outcome = await result;
    expect(abortedAtExpiry).toBe(true);
    expect(outcome).toBeInstanceOf(LeaseLostError);
    expect(heartbeat).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still aborts the operation when a failure callback throws", async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    let release!: () => void;
    const operation = new Promise<string>((resolve) => { release = () => resolve("done"); });
    const result = runWithLeaseHeartbeat({
      jobId: "callback-failure", leaseMs: 30_000,
      heartbeat: async () => ({ count: 0 }),
      onHeartbeatFailure: () => { throw new Error("callback failed"); },
      run: (value) => { signal = value; return operation; },
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    const aborted = signal.aborted;
    release();
    expect(await result).toBeInstanceOf(LeaseLostError);
    expect(aborted).toBe(true);
  });

  it("does not extend a renewed lease by the database response latency", async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    let release!: () => void;
    let acknowledge!: (result: { count: number }) => void;
    const heartbeat = vi.fn(() => new Promise<{ count: number }>((resolve) => { acknowledge = resolve; }));
    const result = runWithLeaseHeartbeat({
      jobId: "slow-renewal", leaseMs: 30_000, heartbeat,
      run: (value) => { signal = value; return new Promise<string>((resolve) => { release = () => resolve("done"); }); },
    }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(29_000);
    acknowledge({ count: 1 }); // Renewal started at 10s, so its lease ends at 40s.
    await vi.advanceTimersByTimeAsync(0);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(11_001);
    expect(signal.aborted).toBe(true);
    acknowledge({ count: 1 }); // A late response must not resurrect ownership.
    await vi.advanceTimersByTimeAsync(0);
    release();
    expect(await result).toBeInstanceOf(LeaseLostError);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

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

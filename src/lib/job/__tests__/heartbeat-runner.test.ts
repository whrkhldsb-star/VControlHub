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
});

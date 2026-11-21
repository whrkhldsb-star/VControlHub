import { afterEach, expect, it, vi } from "vitest";
import { createSingletonIntervalWorker } from "../singleton-interval-worker";

afterEach(() => vi.useRealTimers());

it("coalesces concurrent interval lookups and invalidates a pending start on stop", async () => {
  vi.useFakeTimers();
  let finish!: (ms: number) => void;
  const tick = vi.fn();
  const lookup = vi.fn(() => new Promise<number>(resolve => { finish = resolve; }));
  const worker = createSingletonIntervalWorker({ globalKey: "__test_coalesced_boot", tick, resolveIntervalMs: lookup });
  try {
    const first = worker.start();
    const second = worker.start();
    finish(100);
    expect((await Promise.all([first, second])).map(item => item.alreadyStarted)).toEqual([false, true]);
    expect(lookup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(tick.mock.calls.map(call => call[1])).toEqual(["startup", "interval"]);
    worker.stopForTests();
    const pending = worker.start();
    worker.stopForTests();
    finish(100);
    await pending;
    await vi.advanceTimersByTimeAsync(200);
    expect(worker.getState().started).toBe(false);
    expect(tick).toHaveBeenCalledTimes(2);
  } finally { worker.stopForTests(); }
});

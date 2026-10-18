/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Dispatch behaviour of the sync schedule tick.
 *
 * The tick used to await each due job in turn, so its wall-clock was the SUM of
 * every due rsync. With `take: 100` and multi-minute syncs, one tick could
 * outlast many 60s interval periods; `state.running` then turned every later
 * tick into a no-op and the tail of the queue starved behind the head.
 */

const mocks = vi.hoisted(() => ({
  syncJobFindMany: vi.fn(),
  syncJobFindUnique: vi.fn(),
  tryAcquireAdvisoryLock: vi.fn(),
  executeSyncJob: vi.fn(),
  reclaimStaleRunningSyncJobs: vi.fn(),
  isSyncJobDue: vi.fn(),
  errorLog: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    syncJob: {
      findMany: mocks.syncJobFindMany,
      findUnique: mocks.syncJobFindUnique,
    },
  },
}));
vi.mock("@/lib/concurrency/advisory-lock", () => ({
  tryAcquireAdvisoryLock: mocks.tryAcquireAdvisoryLock,
}));
vi.mock("../service-runtime", () => ({
  executeSyncJob: mocks.executeSyncJob,
  reclaimStaleRunningSyncJobs: mocks.reclaimStaleRunningSyncJobs,
}));
vi.mock("../schedule", () => ({
  isSyncJobDue: mocks.isSyncJobDue,
}));
vi.mock("@/lib/logging", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: mocks.errorLog,
    debug: vi.fn(),
  }),
}));
vi.mock("@/lib/config/env", () => ({
  config: { app: { hostname: "test-host" } },
}));

const { runSyncScheduleWorkerOnce, stopSyncScheduleWorkerForTests } = await import(
  "../sync-schedule-worker"
);

function dueJobs(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `job-${index}`,
    schedule: "*/5 * * * *",
    lastSyncAt: null,
    status: "IDLE",
    name: `sync-${index}`,
  }));
}

describe("runSyncScheduleWorkerOnce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopSyncScheduleWorkerForTests();
    mocks.reclaimStaleRunningSyncJobs.mockResolvedValue([]);
    mocks.isSyncJobDue.mockReturnValue(true);
    mocks.tryAcquireAdvisoryLock.mockImplementation(async () => vi.fn(async () => undefined));
    mocks.syncJobFindUnique.mockResolvedValue({
      schedule: "*/5 * * * *",
      lastSyncAt: null,
      status: "IDLE",
    });
    mocks.executeSyncJob.mockResolvedValue({ ok: true });
  });

  it("dispatches due jobs concurrently, capped at 5 in flight", async () => {
    mocks.syncJobFindMany.mockResolvedValue(dueJobs(12));
    let inFlight = 0;
    let peak = 0;
    mocks.executeSyncJob.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
      return { ok: true };
    });

    const started = await runSyncScheduleWorkerOnce("test");

    expect(started).toBe(12);
    expect(peak).toBeLessThanOrEqual(5);
    // Guard against the batching silently degrading back to sequential.
    expect(peak).toBeGreaterThan(1);
  });

  it("reads every scheduled job, so due jobs beyond the first page still run, never-run ones first", async () => {
    // 500 scheduled jobs that are not due, then two due ones on the next page.
    const notDue = dueJobs(500).map((job) => ({ ...job, lastSyncAt: new Date("2026-10-18T00:00:00Z") }));
    const ran = { ...dueJobs(1)[0]!, id: "job-ran", lastSyncAt: new Date("2026-10-01T00:00:00Z") };
    const neverRan = { ...dueJobs(1)[0]!, id: "job-never" };
    mocks.syncJobFindMany.mockResolvedValueOnce(notDue).mockResolvedValueOnce([ran, neverRan]);
    // The re-check under the lock reads a row without an id.
    mocks.isSyncJobDue.mockImplementation((job: { id?: string }) => !job.id || job.id === "job-ran" || job.id === "job-never");
    const order: string[] = [];
    mocks.executeSyncJob.mockImplementation(async (id: string) => { order.push(id); return { ok: true }; });

    await expect(runSyncScheduleWorkerOnce("test")).resolves.toBe(2);

    expect(mocks.syncJobFindMany).toHaveBeenCalledTimes(2);
    expect(mocks.syncJobFindMany.mock.calls[1]![0]).toMatchObject({ cursor: { id: "job-499" }, skip: 1 });
    expect(order).toEqual(["job-never", "job-ran"]);
  });

  it("keeps dispatching the rest of the batch when one job throws", async () => {
    mocks.syncJobFindMany.mockResolvedValue(dueJobs(3));
    mocks.executeSyncJob.mockImplementation(async (jobId: string) => {
      if (jobId === "job-1") throw new Error("rsync exploded");
      return { ok: true };
    });

    const started = await runSyncScheduleWorkerOnce("test");

    expect(mocks.executeSyncJob).toHaveBeenCalledTimes(3);
    // The thrower is not counted, the other two are.
    expect(started).toBe(2);
    expect(mocks.errorLog).toHaveBeenCalledWith(
      "scheduled sync job failed",
      expect.objectContaining({ jobId: "job-1" }),
    );
  });

  it("skips a job whose advisory lock is held elsewhere", async () => {
    mocks.syncJobFindMany.mockResolvedValue(dueJobs(2));
    mocks.tryAcquireAdvisoryLock.mockImplementation(async (_ns: string, id: string) =>
      id === "job-0" ? null : vi.fn(async () => undefined),
    );

    const started = await runSyncScheduleWorkerOnce("test");

    expect(started).toBe(1);
    expect(mocks.executeSyncJob).toHaveBeenCalledTimes(1);
    expect(mocks.executeSyncJob).toHaveBeenCalledWith("job-1", expect.anything());
  });

  it("re-checks due-ness after taking the lock and skips if it changed", async () => {
    mocks.syncJobFindMany.mockResolvedValue(dueJobs(1));
    // Due in the pre-lock pass, no longer due once the lock is held.
    mocks.isSyncJobDue.mockReturnValueOnce(true).mockReturnValue(false);

    expect(await runSyncScheduleWorkerOnce("test")).toBe(0);
    expect(mocks.executeSyncJob).not.toHaveBeenCalled();
  });

  it("does not run a second tick while one is still in flight", async () => {
    mocks.syncJobFindMany.mockResolvedValue(dueJobs(1));
    let release!: () => void;
    mocks.executeSyncJob.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ ok: true }); }),
    );

    const first = runSyncScheduleWorkerOnce("first");
    // Let the first tick reach executeSyncJob before starting the second.
    await new Promise((resolve) => setImmediate(resolve));
    expect(await runSyncScheduleWorkerOnce("second")).toBe(0);

    release();
    expect(await first).toBe(1);
    expect(mocks.executeSyncJob).toHaveBeenCalledTimes(1);
  });

  it("releases each job's advisory lock via onClaimed and again on exit", async () => {
    mocks.syncJobFindMany.mockResolvedValue(dueJobs(1));
    const releaseFn = vi.fn(async () => undefined);
    mocks.tryAcquireAdvisoryLock.mockResolvedValue(releaseFn);

    await runSyncScheduleWorkerOnce("test");

    // The scheduler hands release() to executeSyncJob so the scarce lock
    // connection is freed the moment the CAS makes it redundant.
    const [, options] = mocks.executeSyncJob.mock.calls[0] as [string, { onClaimed: unknown }];
    expect(options.onClaimed).toBe(releaseFn);
    // And the finally still calls it (release is idempotent).
    expect(releaseFn).toHaveBeenCalled();
  });
});

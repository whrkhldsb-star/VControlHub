import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ordering guard for the sync-schedule advisory-lock early-release fix.
 *
 * executeSyncJob accepts { onClaimed } and must invoke it AFTER the CAS
 * (IDLE/ERROR → RUNNING) has claimed the row, and BEFORE any rsync side
 * effect starts. The scheduler passes its advisory-lock release() here so the
 * scarce lock connection is freed the instant RUNNING makes it redundant —
 * instead of being pinned for the whole (possibly hours-long) rsync.
 */

const order: string[] = [];

const prismaMock = {
  syncJob: {
    updateMany: vi.fn(async () => {
      order.push("cas");
      return { count: 1 };
    }),
    update: vi.fn(async () => ({})),
  },
  syncLog: {
    create: vi.fn(async () => ({ id: "log-1" })),
    update: vi.fn(async () => ({})),
  },
};
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

// The execution path reads the credential-bearing variant; `getSyncJobForExecution` (no
// sshKey) is the display/ownership read used by the HTTP routes.
const getSyncJobForExecution = vi.fn(async () => ({
  id: "job-1",
  syncType: "one-way",
  sourceServer: { sshKey: null },
  targetServer: { sshKey: null },
  sourcePath: "/data/a",
  targetPath: "/data/b",
  deleteOrphans: false,
  compress: false,
}));
vi.mock("../service-crud", () => ({ getSyncJobForExecution }));

// First external call inside runOneWayRsync — throw here so the job fails
// fast right after onClaimed, without touching the real SSH/rsync layer.
const buildSshParamsFromServer = vi.fn(async () => {
  order.push("rsync-side-effect");
  throw new Error("ssh unavailable in test");
});
vi.mock("@/lib/ssh/client", () => ({
  buildSshParamsFromServer,
  execRemoteCommand: vi.fn(),
  writeRemoteFile: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  logError: vi.fn(),
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { executeSyncJob } = await import("../service-runtime");

beforeEach(() => {
  order.length = 0;
  vi.clearAllMocks();
  prismaMock.syncJob.updateMany.mockImplementation(async () => {
    order.push("cas");
    return { count: 1 };
  });
  prismaMock.syncLog.create.mockResolvedValue({ id: "log-1" });
  buildSshParamsFromServer.mockImplementation(async () => {
    order.push("rsync-side-effect");
    throw new Error("ssh unavailable in test");
  });
});

describe("executeSyncJob onClaimed ordering", () => {
  it("invokes onClaimed after the CAS claim and before any rsync side effect", async () => {
    const onClaimed = vi.fn(async () => {
      order.push("onClaimed");
    });

    const result = await executeSyncJob("job-1", { onClaimed });

    expect(onClaimed).toHaveBeenCalledTimes(1);
    // CAS must precede release; release must precede the first rsync call.
    expect(order).toEqual(["cas", "onClaimed", "rsync-side-effect"]);
    // The rsync throw is caught and surfaced as a failed result, not rethrown.
    expect(result.ok).toBe(false);
    expect(result.status).toBe("ERROR");
  });

  it("does not call onClaimed when the CAS loses (already RUNNING)", async () => {
    prismaMock.syncJob.updateMany.mockImplementationOnce(async () => {
      order.push("cas");
      return { count: 0 };
    });
    const onClaimed = vi.fn();

    await expect(executeSyncJob("job-1", { onClaimed })).rejects.toThrow(
      /already running or paused/,
    );
    expect(onClaimed).not.toHaveBeenCalled();
  });

  it("runs without an onClaimed callback (manual /run path)", async () => {
    const result = await executeSyncJob("job-1");
    expect(result.ok).toBe(false);
    expect(order).toEqual(["cas", "rsync-side-effect"]);
  });
});

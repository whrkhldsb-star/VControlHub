/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jobFindFirst: vi.fn(),
  enqueueJob: vi.fn(),
  claimNextJob: vi.fn(),
  heartbeatJob: vi.fn(),
  completeJob: vi.fn(),
  failJob: vi.fn(),
  pruneCompletedJobsByType: vi.fn(),
  trafficSnapshotCreate: vi.fn(),
  trafficSnapshotDeleteMany: vi.fn(),
  serverFindMany: vi.fn(),
  sampleRemoteServersTraffic: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: mocks.readFileSync,
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    job: { findFirst: mocks.jobFindFirst },
    trafficSnapshot: {
      create: mocks.trafficSnapshotCreate,
      deleteMany: mocks.trafficSnapshotDeleteMany,
    },
    server: { findMany: mocks.serverFindMany },
  },
}));

vi.mock("@/lib/job/service", () => ({
  enqueueJob: mocks.enqueueJob,
  claimNextJob: mocks.claimNextJob,
  heartbeatJob: mocks.heartbeatJob,
  completeJob: mocks.completeJob,
  failJob: mocks.failJob,
  pruneCompletedJobsByType: mocks.pruneCompletedJobsByType,
}));

vi.mock("@/lib/monitoring/remote-traffic", () => ({
  sampleRemoteServersTraffic: mocks.sampleRemoteServersTraffic,
}));

import {
  enqueueTrafficSampleIfIdle,
  runTrafficSamplingWorkerOnce,
  stopTrafficSamplingWorkerForTests,
} from "../traffic-sampling-worker";

const PROC_NET_DEV = `
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1000       10    0    0    0     0          0         0     1000      10    0    0    0     0       0          0
  eth0: 2000000    20    0    0    0     0          0         0  3000000      30    0    0    0     0       0          0
`;

describe("traffic sampling worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopTrafficSamplingWorkerForTests();
    mocks.jobFindFirst.mockResolvedValue(null);
    mocks.enqueueJob.mockResolvedValue({ id: "queued" });
    mocks.claimNextJob.mockResolvedValue({ id: "job1", payload: {}, attempts: 1, maxAttempts: 2 });
    mocks.readFileSync.mockReturnValue(PROC_NET_DEV);
    mocks.serverFindMany.mockResolvedValue([
      {
        id: "srv1",
        name: "edge",
        host: "1.2.3.4",
        port: 22,
        username: "root",
        password: "x",
        sshKeyId: null,
        sshKey: null,
      },
    ]);
    mocks.sampleRemoteServersTraffic.mockResolvedValue([
      {
        serverId: "srv1",
        serverName: "edge",
        host: "1.2.3.4",
        primaryInterface: {
          iface: "eth0",
          rxBytes: 5000,
          txBytes: 6000,
          rxLabel: "5 KB",
          txLabel: "6 KB",
          rxRateBytesPerSecond: 12,
          txRateBytesPerSecond: 18,
          rxRateLabel: "12 B/s",
          txRateLabel: "18 B/s",
          intervalSeconds: 60,
        },
        interfaces: [],
        sampledAt: new Date().toISOString(),
        error: null,
      },
    ]);
    mocks.trafficSnapshotCreate.mockResolvedValue({ id: "snap" });
    mocks.trafficSnapshotDeleteMany.mockResolvedValue({ count: 2 });
    mocks.pruneCompletedJobsByType.mockResolvedValue({ count: 0 });
  });

  it("does not enqueue a duplicate pending/running sample", async () => {
    mocks.jobFindFirst.mockResolvedValue({ id: "active" });
    expect(await enqueueTrafficSampleIfIdle("interval")).toBe(false);
    expect(mocks.enqueueJob).not.toHaveBeenCalled();
  });

  it("samples local + remote primary interfaces, prunes snapshots/jobs, and completes", async () => {
    expect(await runTrafficSamplingWorkerOnce("test")).toBe(true);

    expect(mocks.trafficSnapshotCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: "local",
          serverId: null,
          iface: "eth0",
        }),
      }),
    );
    expect(mocks.trafficSnapshotCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: "server",
          serverId: "srv1",
          iface: "eth0",
          rxRateBps: 12,
          txRateBps: 18,
        }),
      }),
    );
    expect(mocks.trafficSnapshotDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sampledAt: { lt: expect.any(Date) } } }),
    );
    expect(mocks.pruneCompletedJobsByType).toHaveBeenCalledWith(
      expect.objectContaining({ type: "traffic.sample", keepLatest: 50 }),
    );
    expect(mocks.completeJob).toHaveBeenCalledWith(
      "job1",
      expect.any(String),
      expect.objectContaining({
        localSampled: true,
        remoteSampled: 1,
        prunedSnapshots: 2,
      }),
    );
  });

  it("fails the durable job when local sampling hard-fails", async () => {
    mocks.readFileSync.mockImplementation(() => {
      throw new Error("proc unreadable");
    });
    // readProcNetDev swallows read errors; force persist failure instead
    mocks.readFileSync.mockReturnValue(PROC_NET_DEV);
    mocks.trafficSnapshotCreate.mockRejectedValueOnce(new Error("db down"));

    expect(await runTrafficSamplingWorkerOnce("test")).toBe(true);
    expect(mocks.failJob).toHaveBeenCalledWith(
      "job1",
      expect.any(String),
      expect.stringContaining("db down"),
      expect.any(Object),
    );
  });
});

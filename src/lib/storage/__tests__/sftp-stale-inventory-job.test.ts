import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  claimNextJobMock,
  completeJobMock,
  failJobMock,
  heartbeatJobMock,
  enqueueJobMock,
  jobFindFirstMock,
  acquireAdvisoryLockMock,
  detectAndPruneSftpStaleInventoryMock,
  listSftpNodesForStaleInventoryMock,
  loggerWarnMock,
} = vi.hoisted(() => ({
  claimNextJobMock: vi.fn(),
  completeJobMock: vi.fn(),
  failJobMock: vi.fn(),
  heartbeatJobMock: vi.fn(),
  enqueueJobMock: vi.fn(),
  jobFindFirstMock: vi.fn(),
  acquireAdvisoryLockMock: vi.fn(),
  detectAndPruneSftpStaleInventoryMock: vi.fn(),
  listSftpNodesForStaleInventoryMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: loggerWarnMock,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@/lib/job/service", () => ({
  claimNextJob: claimNextJobMock,
  completeJob: completeJobMock,
  failJob: failJobMock,
  heartbeatJob: heartbeatJobMock,
  enqueueJob: enqueueJobMock,
}));
vi.mock("@/lib/job/heartbeat-runner", () => ({
  runWithLeaseHeartbeat: vi.fn(async (input: { run: () => Promise<unknown> }) =>
    input.run(),
  ),
}));
vi.mock("@/lib/db", () => ({
  prisma: { job: { findFirst: jobFindFirstMock } },
}));
vi.mock("@/lib/concurrency/advisory-lock", () => ({
  acquireAdvisoryLock: acquireAdvisoryLockMock,
}));

vi.mock("../sftp-stale-inventory", () => ({
  detectAndPruneSftpStaleInventory: detectAndPruneSftpStaleInventoryMock,
  listSftpNodesForStaleInventory: listSftpNodesForStaleInventoryMock,
}));

import {
  enqueueSftpStaleInventorySweepIfIdle,
  parseSftpStaleInventoryJobPayload,
  runSftpStaleInventoryJobWorkerOnce,
  SFTP_STALE_INVENTORY_JOB_TYPE,
  stopSftpStaleInventoryWorkerForTests,
} from "../sftp-stale-inventory-job";

const sampleResult = {
  nodeId: "node_1",
  nodeName: "remote",
  basePath: "/data",
  scanned: 10,
  stale: 2,
  errors: [],
  durationMs: 100,
  dryRun: false,
};

describe("SFTP stale inventory durable job worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    heartbeatJobMock.mockResolvedValue({ count: 1 });
    completeJobMock.mockResolvedValue({ count: 1 });
    failJobMock.mockResolvedValue({ count: 1 });
    // Advisory lock: no-op release. Default findFirst => a sweep is already in
    // flight, so the periodic producer no-ops and existing consume-path tests
    // are unaffected (they exercise claimNextJob, not the producer).
    acquireAdvisoryLockMock.mockResolvedValue(async () => {});
    jobFindFirstMock.mockResolvedValue({ id: "in-flight-sweep" });
    enqueueJobMock.mockResolvedValue({ id: "job_enqueued" });
  });

  afterEach(() => {
    stopSftpStaleInventoryWorkerForTests();
  });

  describe("parseSftpStaleInventoryJobPayload", () => {
    it("returns defaults for non-object payloads", () => {
      expect(parseSftpStaleInventoryJobPayload(null)).toEqual({});
      expect(parseSftpStaleInventoryJobPayload("string")).toEqual({});
      expect(parseSftpStaleInventoryJobPayload([])).toEqual({});
    });

    it("clamps maxDepth to the [0, 10] range", () => {
      expect(parseSftpStaleInventoryJobPayload({ maxDepth: 99 }).maxDepth).toBe(
        10,
      );
      expect(parseSftpStaleInventoryJobPayload({ maxDepth: -3 }).maxDepth).toBe(
        0,
      );
      expect(
        parseSftpStaleInventoryJobPayload({ maxDepth: 3.7 }).maxDepth,
      ).toBe(3);
    });

    it("parses optional nodeId, dryRun, reason", () => {
      expect(
        parseSftpStaleInventoryJobPayload({
          nodeId: "node_1",
          dryRun: true,
          reason: "manual",
        }),
      ).toEqual({
        nodeId: "node_1",
        nodeIds: undefined,
        maxDepth: undefined,
        dryRun: true,
        reason: "manual",
      });
    });

    it("parses nodeIds and preserves empty arrays (team-scoped pin)", () => {
      expect(
        parseSftpStaleInventoryJobPayload({
          nodeIds: ["n1", 2, "", "n2"],
        }),
      ).toEqual({
        nodeId: undefined,
        nodeIds: ["n1", "n2"],
        maxDepth: undefined,
        dryRun: undefined,
        reason: undefined,
      });
      expect(
        parseSftpStaleInventoryJobPayload({ nodeIds: [] }).nodeIds,
      ).toEqual([]);
    });
  });

  describe("enqueueSftpStaleInventorySweepIfIdle (periodic producer)", () => {
    it("enqueues one global all-nodes sweep when the queue is idle", async () => {
      jobFindFirstMock.mockResolvedValueOnce(null);
      const enqueued = await enqueueSftpStaleInventorySweepIfIdle("interval");
      expect(enqueued).toBe(true);
      expect(enqueueJobMock).toHaveBeenCalledTimes(1);
      const arg = enqueueJobMock.mock.calls[0]![0] as {
        type: string;
        payload: Record<string, unknown>;
      };
      expect(arg.type).toBe(SFTP_STALE_INVENTORY_JOB_TYPE);
      // Global sweep: no node scoping → executeStaleInventoryJob scans all nodes.
      expect(arg.payload.nodeId).toBeUndefined();
      expect(arg.payload.nodeIds).toBeUndefined();
    });

    it("does not enqueue when a sweep is already pending or running", async () => {
      jobFindFirstMock.mockResolvedValueOnce({ id: "in-flight" });
      const enqueued = await enqueueSftpStaleInventorySweepIfIdle("interval");
      expect(enqueued).toBe(false);
      expect(enqueueJobMock).not.toHaveBeenCalled();
    });

    it("is invoked by the worker tick before it consumes", async () => {
      jobFindFirstMock.mockResolvedValueOnce(null);
      claimNextJobMock.mockResolvedValueOnce(null);
      await runSftpStaleInventoryJobWorkerOnce();
      expect(enqueueJobMock).toHaveBeenCalledTimes(1);
      expect(claimNextJobMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("runSftpStaleInventoryJobWorkerOnce", () => {
    it("returns false when no job is claimed", async () => {
      claimNextJobMock.mockResolvedValueOnce(null);
      const result = await runSftpStaleInventoryJobWorkerOnce();
      expect(result).toBe(false);
      expect(completeJobMock).not.toHaveBeenCalled();
    });

    it("scans a single node when payload specifies a nodeId", async () => {
      const node = {
        id: "node_1",
        name: "remote",
        driver: "SFTP" as const,
        basePath: "/data",
        healthStatus: "HEALTHY" as const,
        lastHealthError: null,
      };
      listSftpNodesForStaleInventoryMock.mockResolvedValueOnce([node]);
      claimNextJobMock.mockResolvedValueOnce({
        id: "job_1",
        payload: { nodeId: "node_1", maxDepth: 4 },
      });
      detectAndPruneSftpStaleInventoryMock.mockResolvedValueOnce(sampleResult);

      const result = await runSftpStaleInventoryJobWorkerOnce();
      expect(result).toBe(true);

      expect(detectAndPruneSftpStaleInventoryMock).toHaveBeenCalledWith(
        expect.objectContaining({ maxDepth: 4, dryRun: false }),
      );
      expect(completeJobMock).toHaveBeenCalledWith(
        "job_1",
        expect.any(String),
        expect.objectContaining({
          mode: "single",
          results: [sampleResult],
          totals: {
            nodes: 1,
            scanned: 10,
            stale: 2,
            errors: 0,
            durationMs: 100,
          },
        }),
      );
    });

    it("scans all SFTP nodes when no nodeId is specified", async () => {
      const nodes = [
        {
          id: "n1",
          name: "alpha",
          driver: "SFTP" as const,
          basePath: "/a",
          healthStatus: "HEALTHY" as const,
          lastHealthError: null,
        },
        {
          id: "n2",
          name: "beta",
          driver: "SFTP" as const,
          basePath: "/b",
          healthStatus: "HEALTHY" as const,
          lastHealthError: null,
        },
      ];
      listSftpNodesForStaleInventoryMock.mockResolvedValueOnce(nodes);
      claimNextJobMock.mockResolvedValueOnce({
        id: "job_2",
        payload: { maxDepth: 2 },
      });
      detectAndPruneSftpStaleInventoryMock
        .mockResolvedValueOnce({ ...sampleResult, nodeId: "n1" })
        .mockResolvedValueOnce({ ...sampleResult, nodeId: "n2", stale: 5 });

      await runSftpStaleInventoryJobWorkerOnce();

      expect(detectAndPruneSftpStaleInventoryMock).toHaveBeenCalledTimes(2);
      expect(completeJobMock).toHaveBeenCalledWith(
        "job_2",
        expect.any(String),
        expect.objectContaining({
          mode: "all",
          totals: expect.objectContaining({ nodes: 2, stale: 7 }),
        }),
      );
    });

    it("skips UNHEALTHY nodes and reports them in the totals", async () => {
      const nodes = [
        {
          id: "n1",
          name: "broken",
          driver: "SFTP" as const,
          basePath: "/a",
          healthStatus: "UNHEALTHY" as const,
          lastHealthError: "ssh timeout",
        },
        {
          id: "n2",
          name: "ok",
          driver: "SFTP" as const,
          basePath: "/b",
          healthStatus: "HEALTHY" as const,
          lastHealthError: null,
        },
      ];
      listSftpNodesForStaleInventoryMock.mockResolvedValueOnce(nodes);
      claimNextJobMock.mockResolvedValueOnce({
        id: "job_3",
        payload: {},
      });
      detectAndPruneSftpStaleInventoryMock.mockResolvedValueOnce(sampleResult);

      await runSftpStaleInventoryJobWorkerOnce();

      expect(detectAndPruneSftpStaleInventoryMock).toHaveBeenCalledTimes(1);
      expect(completeJobMock).toHaveBeenCalledWith(
        "job_3",
        expect.any(String),
        expect.objectContaining({
          totals: expect.objectContaining({ errors: 1 }),
        }),
      );
    });

    it("fails the job with retryAfterMs when execution throws", async () => {
      listSftpNodesForStaleInventoryMock.mockResolvedValueOnce([
        {
          id: "n1",
          name: "x",
          driver: "SFTP" as const,
          basePath: "/",
          healthStatus: "HEALTHY" as const,
          lastHealthError: null,
        },
      ]);
      claimNextJobMock.mockResolvedValueOnce({
        id: "job_4",
        payload: { nodeId: "n1" },
      });
      detectAndPruneSftpStaleInventoryMock.mockRejectedValueOnce(
        new Error("ssh handshake failed"),
      );

      await runSftpStaleInventoryJobWorkerOnce();

      expect(failJobMock).toHaveBeenCalledWith(
        "job_4",
        expect.any(String),
        "ssh handshake failed",
        expect.objectContaining({ retryAfterMs: expect.any(Number) }),
      );
    });

    it("surfaces real per-node scan errors to the log while still completing the job", async () => {
      const nodes = [
        {
          id: "n1",
          name: "alpha",
          driver: "SFTP" as const,
          basePath: "/a",
          healthStatus: "HEALTHY" as const,
          lastHealthError: null,
        },
      ];
      listSftpNodesForStaleInventoryMock.mockResolvedValueOnce(nodes);
      claimNextJobMock.mockResolvedValueOnce({ id: "job_realerr", payload: {} });
      // A node that connected but failed mid-scan: real error, not a skip.
      detectAndPruneSftpStaleInventoryMock.mockResolvedValueOnce({
        ...sampleResult,
        nodeId: "n1",
        scanned: 0,
        errors: ["Connection credentials unavailable: vault down"],
      });

      await runSftpStaleInventoryJobWorkerOnce();

      // Job still completes (records the structured per-node diagnostics)…
      expect(completeJobMock).toHaveBeenCalledWith(
        "job_realerr",
        expect.any(String),
        expect.objectContaining({ totals: expect.objectContaining({ errors: 1 }) }),
      );
      // …but the real error is surfaced to the log so status-based alerting
      // doesn't miss a sweep that silently failed to scan.
      expect(loggerWarnMock).toHaveBeenCalledWith(
        expect.stringContaining("per-node scan errors"),
        expect.objectContaining({ jobId: "job_realerr", failedNodeCount: 1 }),
      );
    });

    it("does not log a warning when the only errors are benign UNHEALTHY skips", async () => {
      const nodes = [
        {
          id: "n1",
          name: "broken",
          driver: "SFTP" as const,
          basePath: "/a",
          healthStatus: "UNHEALTHY" as const,
          lastHealthError: "ssh timeout",
        },
      ];
      listSftpNodesForStaleInventoryMock.mockResolvedValueOnce(nodes);
      claimNextJobMock.mockResolvedValueOnce({ id: "job_skip", payload: {} });

      await runSftpStaleInventoryJobWorkerOnce();

      // UNHEALTHY skip is by-design (P-001-A) and tracked by health monitoring —
      // it must not trigger a noisy per-tick error log.
      expect(loggerWarnMock).not.toHaveBeenCalledWith(
        expect.stringContaining("per-node scan errors"),
        expect.anything(),
      );
      expect(completeJobMock).toHaveBeenCalled();
    });

    it("completes immediately with empty results when no SFTP nodes exist", async () => {
      listSftpNodesForStaleInventoryMock.mockResolvedValueOnce([]);
      claimNextJobMock.mockResolvedValueOnce({
        id: "job_5",
        payload: {},
      });

      await runSftpStaleInventoryJobWorkerOnce();

      expect(completeJobMock).toHaveBeenCalledWith(
        "job_5",
        expect.any(String),
        expect.objectContaining({
          mode: "all",
          totals: { nodes: 0, scanned: 0, stale: 0, errors: 0, durationMs: 0 },
        }),
      );
    });

    it("filters to payload.nodeIds for team-scoped multi-node jobs", async () => {
      const nodes = [
        {
          id: "n1",
          name: "alpha",
          driver: "SFTP" as const,
          basePath: "/a",
          healthStatus: "HEALTHY" as const,
          lastHealthError: null,
        },
        {
          id: "n2",
          name: "beta",
          driver: "SFTP" as const,
          basePath: "/b",
          healthStatus: "HEALTHY" as const,
          lastHealthError: null,
        },
        {
          id: "n3",
          name: "gamma",
          driver: "SFTP" as const,
          basePath: "/c",
          healthStatus: "HEALTHY" as const,
          lastHealthError: null,
        },
      ];
      listSftpNodesForStaleInventoryMock.mockResolvedValueOnce(nodes);
      claimNextJobMock.mockResolvedValueOnce({
        id: "job_scoped",
        payload: { nodeIds: ["n1", "n3"] },
      });
      detectAndPruneSftpStaleInventoryMock
        .mockResolvedValueOnce({ ...sampleResult, nodeId: "n1" })
        .mockResolvedValueOnce({ ...sampleResult, nodeId: "n3" });

      await runSftpStaleInventoryJobWorkerOnce();

      expect(detectAndPruneSftpStaleInventoryMock).toHaveBeenCalledTimes(2);
      expect(completeJobMock).toHaveBeenCalledWith(
        "job_scoped",
        expect.any(String),
        expect.objectContaining({
          mode: "scoped",
          totals: expect.objectContaining({ nodes: 2 }),
        }),
      );
    });

    it("does not widen empty nodeIds to all tenants", async () => {
      listSftpNodesForStaleInventoryMock.mockResolvedValueOnce([
        {
          id: "n1",
          name: "alpha",
          driver: "SFTP" as const,
          basePath: "/a",
          healthStatus: "HEALTHY" as const,
          lastHealthError: null,
        },
      ]);
      claimNextJobMock.mockResolvedValueOnce({
        id: "job_empty_scope",
        payload: { nodeIds: [] },
      });

      await runSftpStaleInventoryJobWorkerOnce();

      expect(detectAndPruneSftpStaleInventoryMock).not.toHaveBeenCalled();
      expect(completeJobMock).toHaveBeenCalledWith(
        "job_empty_scope",
        expect.any(String),
        expect.objectContaining({
          mode: "scoped",
          totals: { nodes: 0, scanned: 0, stale: 0, errors: 0, durationMs: 0 },
        }),
      );
    });
  });

  it("uses the right job type", () => {
    expect(SFTP_STALE_INVENTORY_JOB_TYPE).toBe("storage.sftp-stale-inventory");
  });
});

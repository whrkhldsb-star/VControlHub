import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  claimNextJobMock,
  completeJobMock,
  failJobMock,
  heartbeatJobMock,
  detectAndPruneSftpStaleInventoryMock,
  listSftpNodesForStaleInventoryMock,
} = vi.hoisted(() => ({
  claimNextJobMock: vi.fn(),
  completeJobMock: vi.fn(),
  failJobMock: vi.fn(),
  heartbeatJobMock: vi.fn(),
  detectAndPruneSftpStaleInventoryMock: vi.fn(),
  listSftpNodesForStaleInventoryMock: vi.fn(),
}));

vi.mock("@/lib/job/service", () => ({
  claimNextJob: claimNextJobMock,
  completeJob: completeJobMock,
  failJob: failJobMock,
  heartbeatJob: heartbeatJobMock,
}));

vi.mock("../sftp-stale-inventory", () => ({
  detectAndPruneSftpStaleInventory: detectAndPruneSftpStaleInventoryMock,
  listSftpNodesForStaleInventory: listSftpNodesForStaleInventoryMock,
}));

import {
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
      expect(
        parseSftpStaleInventoryJobPayload({ maxDepth: 99 }).maxDepth,
      ).toBe(10);
      expect(
        parseSftpStaleInventoryJobPayload({ maxDepth: -3 }).maxDepth,
      ).toBe(0);
      expect(parseSftpStaleInventoryJobPayload({ maxDepth: 3.7 }).maxDepth).toBe(
        3,
      );
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
        maxDepth: undefined,
        dryRun: true,
        reason: "manual",
      });
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
          totals: { nodes: 1, scanned: 10, stale: 2, errors: 0, durationMs: 100 },
        }),
      );
    });

    it("scans all SFTP nodes when no nodeId is specified", async () => {
      const nodes = [
        { id: "n1", name: "alpha", driver: "SFTP" as const, basePath: "/a", healthStatus: "HEALTHY" as const, lastHealthError: null },
        { id: "n2", name: "beta", driver: "SFTP" as const, basePath: "/b", healthStatus: "HEALTHY" as const, lastHealthError: null },
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
        { id: "n1", name: "x", driver: "SFTP" as const, basePath: "/", healthStatus: "HEALTHY" as const, lastHealthError: null },
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
  });

  it("uses the right job type", () => {
    expect(SFTP_STALE_INVENTORY_JOB_TYPE).toBe("storage.sftp-stale-inventory");
  });
});

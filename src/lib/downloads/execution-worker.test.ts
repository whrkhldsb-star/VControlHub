import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const {
  enqueueJobMock,
  claimNextJobMock,
  completeJobMock,
  failJobMock,
  heartbeatJobMock,
  executeAria2RelayDownloadMock,
  executeDirectDownloadMock,
  prismaDownloadTaskFindUniqueMock,
  decryptServerPasswordMock,
  decryptSshPrivateKeyMock,
  infoMock,
  warnMock,
  errorMock,
} = vi.hoisted(() => ({
  enqueueJobMock: vi.fn(),
  claimNextJobMock: vi.fn(),
  completeJobMock: vi.fn(),
  failJobMock: vi.fn(),
  heartbeatJobMock: vi.fn(),
  executeAria2RelayDownloadMock: vi.fn(),
  executeDirectDownloadMock: vi.fn(),
  prismaDownloadTaskFindUniqueMock: vi.fn(),
  decryptServerPasswordMock: vi.fn((value: string) => `decrypted:${value}`),
  decryptSshPrivateKeyMock: vi.fn((value: string) => `decrypted:${value}`),
  infoMock: vi.fn(),
  warnMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("@/lib/job/service", () => ({
  enqueueJob: enqueueJobMock,
  claimNextJob: claimNextJobMock,
  completeJob: completeJobMock,
  failJob: failJobMock,
  heartbeatJob: heartbeatJobMock,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    downloadTask: {
      findUnique: prismaDownloadTaskFindUniqueMock,
    },
  },
}));

vi.mock("@/lib/ssh/ssh-key-crypto", () => ({
  decryptServerPassword: decryptServerPasswordMock,
  decryptSshPrivateKey: decryptSshPrivateKeyMock,
}));

vi.mock("./execution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./execution")>();
  return {
    ...actual,
    executeAria2RelayDownload: executeAria2RelayDownloadMock,
    executeDirectDownload: executeDirectDownloadMock,
  };
});

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({
    info: infoMock,
    warn: warnMock,
    error: errorMock,
  }),
}));

import {
  DOWNLOAD_EXECUTION_JOB_TYPE,
  enqueueDownloadExecutionJob,
  parseDownloadExecutionJobPayload,
  runDownloadExecutionJobWorkerOnce,
  startDownloadJobWorker,
  stopDownloadJobWorkerForTests,
} from "./execution-worker";

function makeJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "job-dl-1",
    type: DOWNLOAD_EXECUTION_JOB_TYPE,
    payload: {
      mode: "direct",
      taskId: "task-1",
      userId: "u-1",
      requestedAt: new Date().toISOString(),
    } as Prisma.JsonValue,
    attempts: 1,
    maxAttempts: 1,
    ...overrides,
  };
}

function makeTaskRow() {
  return {
    id: "task-1",
    url: "https://example.com/file.iso",
    targetPath: "/srv/cloud/downloads",
    fileName: "file.iso",
    relayMode: false,
    maxSpeedKb: null,
    createdBy: "u-1",
    server: {
      host: "203.0.113.10",
      port: 22,
      username: "root",
      sshKeyId: "key_1",
      password: "encrypted-password",
      storageNode: { id: "store_1", basePath: "/srv/cloud" },
      sshKey: { privateKey: "encrypted-key" },
    },
  };
}

describe("download execution durable job worker", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    enqueueJobMock.mockResolvedValue({ id: "job-dl-enqueued" });
    claimNextJobMock.mockResolvedValue(null);
    completeJobMock.mockResolvedValue({ count: 1 });
    failJobMock.mockResolvedValue({ count: 1 });
    heartbeatJobMock.mockResolvedValue({ count: 1 });
    executeAria2RelayDownloadMock.mockResolvedValue(undefined);
    executeDirectDownloadMock.mockResolvedValue(undefined);
    prismaDownloadTaskFindUniqueMock.mockResolvedValue(makeTaskRow());
    stopDownloadJobWorkerForTests();
  });

  describe("enqueueDownloadExecutionJob", () => {
    it("enqueues an aria2 relay job with the relay title", async () => {
      const result = await enqueueDownloadExecutionJob({
        mode: "aria2_relay",
        taskId: "  task-42 ",
        userId: "u-1",
      });

      expect(result).toEqual({ id: "job-dl-enqueued" });
      expect(enqueueJobMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: DOWNLOAD_EXECUTION_JOB_TYPE,
          title: "中转下载 task-42",
          payload: expect.objectContaining({
            mode: "aria2_relay",
            taskId: "task-42",
            userId: "u-1",
            requestedAt: expect.any(String),
          }),
          // TR-001 T13b: bumped from 1 to 3 so a transient dispatch blip
          // (aria2 RPC timeout, ssh pipe EOF, etc.) retries instead of
          // permanently failing the job. The claim worker still uses
          // maxAttempts=1 internally for the `exhausted` bookkeeping.
          maxAttempts: 3,
        }),
      );
    });

    it("enqueues a direct download job with the direct title", async () => {
      await enqueueDownloadExecutionJob({
        mode: "direct",
        taskId: "task-7",
        userId: null,
      });

      expect(enqueueJobMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "直连下载 task-7",
          payload: expect.objectContaining({
            mode: "direct",
            taskId: "task-7",
            userId: null,
          }),
        }),
      );
    });

    it("rejects an empty taskId to surface caller bugs early", async () => {
      await expect(
        enqueueDownloadExecutionJob({ mode: "direct", taskId: "   " }),
      ).rejects.toThrow(/taskId/);
      expect(enqueueJobMock).not.toHaveBeenCalled();
    });
  });

  describe("parseDownloadExecutionJobPayload", () => {
    it("throws when the payload is missing the mode field", () => {
      expect(() => parseDownloadExecutionJobPayload({ taskId: "t-1" })).toThrow(/mode/);
    });

    it("throws when the mode is not aria2_relay or direct", () => {
      expect(() =>
        parseDownloadExecutionJobPayload({ mode: "weird", taskId: "t-1" }),
      ).toThrow(/mode/);
    });

    it("throws when the payload is missing the taskId field", () => {
      expect(() => parseDownloadExecutionJobPayload({ mode: "direct" })).toThrow(/taskId/);
    });

    it("returns a normalised payload for a well-formed input", () => {
      const parsed = parseDownloadExecutionJobPayload({
        mode: "aria2_relay",
        taskId: "  task-1  ",
        userId: "  u-1  ",
      });
      expect(parsed).toEqual({
        mode: "aria2_relay",
        taskId: "task-1",
        userId: "u-1",
        requestedAt: undefined,
      });
    });
  });

  describe("runDownloadExecutionJobWorkerOnce", () => {
    it("dispatches a direct download via executeDirectDownload with re-decrypted server fields", async () => {
      claimNextJobMock.mockResolvedValueOnce(makeJob());
      executeDirectDownloadMock.mockResolvedValueOnce(undefined);

      const result = await runDownloadExecutionJobWorkerOnce();

      expect(result).toBe(true);
      expect(claimNextJobMock).toHaveBeenCalledWith(
        expect.objectContaining({
          types: [DOWNLOAD_EXECUTION_JOB_TYPE],
          leaseMs: expect.any(Number),
        }),
      );
      expect(heartbeatJobMock).toHaveBeenCalledWith(
        "job-dl-1",
        expect.stringContaining(":download-execution:"),
        expect.objectContaining({ progress: expect.stringContaining("task-1") }),
      );
      expect(prismaDownloadTaskFindUniqueMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "task-1" } }),
      );
      expect(decryptSshPrivateKeyMock).toHaveBeenCalledWith("encrypted-key");
      expect(decryptServerPasswordMock).toHaveBeenCalledWith("encrypted-password");
      expect(executeDirectDownloadMock).toHaveBeenCalledWith(
        "task-1",
        expect.objectContaining({
          host: "203.0.113.10",
          port: 22,
          username: "root",
          password: "decrypted:encrypted-password",
          sshKey: { privateKey: "decrypted:encrypted-key" },
          storageNode: { id: "store_1", basePath: "/srv/cloud" },
        }),
        "https://example.com/file.iso",
        "/srv/cloud/downloads",
        "file.iso",
        "u-1",
      );
      expect(executeAria2RelayDownloadMock).not.toHaveBeenCalled();
      expect(completeJobMock).toHaveBeenCalledWith(
        "job-dl-1",
        expect.stringContaining(":download-execution:"),
        expect.objectContaining({
          taskId: "task-1",
          mode: "direct",
          status: "dispatched",
        }),
      );
      expect(failJobMock).not.toHaveBeenCalled();
    });

    it("dispatches an aria2 relay job via executeAria2RelayDownload", async () => {
      claimNextJobMock.mockResolvedValueOnce(
        makeJob({
          payload: {
            mode: "aria2_relay",
            taskId: "task-2",
            userId: "u-2",
            requestedAt: new Date().toISOString(),
          } as Prisma.JsonValue,
        }),
      );
      prismaDownloadTaskFindUniqueMock.mockResolvedValueOnce({
        ...makeTaskRow(),
        id: "task-2",
        url: "magnet:?xt=urn:btih:abcdef",
        relayMode: true,
        maxSpeedKb: 1024,
        fileName: null,
      });
      executeAria2RelayDownloadMock.mockResolvedValueOnce(undefined);

      const result = await runDownloadExecutionJobWorkerOnce();

      expect(result).toBe(true);
      expect(executeAria2RelayDownloadMock).toHaveBeenCalledWith(
        "task-2",
        expect.objectContaining({ host: "203.0.113.10" }),
        ["magnet:?xt=urn:btih:abcdef"],
        "/srv/cloud/downloads",
        null,
        1024,
        "u-2",
      );
      expect(executeDirectDownloadMock).not.toHaveBeenCalled();
      expect(completeJobMock).toHaveBeenCalledWith(
        "job-dl-1",
        expect.stringContaining(":download-execution:"),
        expect.objectContaining({ mode: "aria2_relay" }),
      );
    });

    it("falls back to task.createdBy when payload userId is missing", async () => {
      claimNextJobMock.mockResolvedValueOnce(
        makeJob({
          payload: {
            mode: "direct",
            taskId: "task-3",
            requestedAt: new Date().toISOString(),
          } as Prisma.JsonValue,
        }),
      );
      prismaDownloadTaskFindUniqueMock.mockResolvedValueOnce({
        ...makeTaskRow(),
        id: "task-3",
        createdBy: "u-fallback",
      });

      await runDownloadExecutionJobWorkerOnce();

      expect(executeDirectDownloadMock).toHaveBeenCalledWith(
        "task-3",
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        "u-fallback",
      );
    });

    it("skips dispatch entirely when the claim returns no job", async () => {
      claimNextJobMock.mockResolvedValueOnce(null);

      const result = await runDownloadExecutionJobWorkerOnce();

      expect(result).toBe(false);
      expect(prismaDownloadTaskFindUniqueMock).not.toHaveBeenCalled();
      expect(executeDirectDownloadMock).not.toHaveBeenCalled();
      expect(executeAria2RelayDownloadMock).not.toHaveBeenCalled();
      expect(completeJobMock).not.toHaveBeenCalled();
      expect(failJobMock).not.toHaveBeenCalled();
    });

    it("fails the job when the underlying download task row has been deleted", async () => {
      claimNextJobMock.mockResolvedValueOnce(makeJob());
      prismaDownloadTaskFindUniqueMock.mockResolvedValueOnce(null);

      const result = await runDownloadExecutionJobWorkerOnce();

      expect(result).toBe(true);
      expect(failJobMock).toHaveBeenCalledWith(
        "job-dl-1",
        expect.stringContaining(":download-execution:"),
        expect.stringContaining("task-1"),
      );
      expect(executeDirectDownloadMock).not.toHaveBeenCalled();
      expect(completeJobMock).not.toHaveBeenCalled();
    });

    it("fails the job when the payload is malformed (cannot recover)", async () => {
      claimNextJobMock.mockResolvedValueOnce(
        makeJob({ payload: { mode: "direct" } as Prisma.JsonValue }),
      );

      const result = await runDownloadExecutionJobWorkerOnce();

      expect(result).toBe(true);
      expect(failJobMock).toHaveBeenCalledWith(
        "job-dl-1",
        expect.stringContaining(":download-execution:"),
        expect.stringContaining("taskId"),
      );
      expect(executeDirectDownloadMock).not.toHaveBeenCalled();
    });

    it("records the failure on the job when the dispatch helper throws (e.g. prisma crash)", async () => {
      claimNextJobMock.mockResolvedValueOnce(makeJob());
      executeDirectDownloadMock.mockRejectedValueOnce(new Error("prisma down"));

      const result = await runDownloadExecutionJobWorkerOnce();

      expect(result).toBe(true);
      expect(failJobMock).toHaveBeenCalledWith(
        "job-dl-1",
        expect.stringContaining(":download-execution:"),
        expect.stringContaining("prisma down"),
      );
      expect(completeJobMock).not.toHaveBeenCalled();
      expect(errorMock).toHaveBeenCalled();
    });

    it("does not overlap concurrent ticks", async () => {
      let releaseClaim!: (value: unknown) => void;
      claimNextJobMock.mockImplementationOnce(
        () => new Promise((resolve) => { releaseClaim = resolve; }),
      );

      const first = runDownloadExecutionJobWorkerOnce();
      const second = await runDownloadExecutionJobWorkerOnce();
      expect(second).toBe(false);
      expect(warnMock).toHaveBeenCalledWith(
        "Skipping download execution tick because a previous tick is still running",
      );

      releaseClaim(null);
      await first;
    });
  });

  describe("startDownloadJobWorker lifecycle", () => {
    it("starts once (idempotent) and logs the workerId", async () => {
      const state = await startDownloadJobWorker();
      const state2 = await startDownloadJobWorker();

      expect(state).toBe(state2);
      expect(infoMock).toHaveBeenCalledWith(
        "download execution durable job worker started",
        expect.objectContaining({
          intervalMs: expect.any(Number),
          workerId: expect.stringContaining(":download-execution:"),
        }),
      );

      stopDownloadJobWorkerForTests();
    });
  });
});

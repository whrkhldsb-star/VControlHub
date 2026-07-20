import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const {
  enqueueJobMock,
  claimNextJobMock,
  completeJobMock,
  failJobMock,
  heartbeatJobMock,
  executeAndFinalizeCommandMock,
  markCommandExecutionFailedMock,
  findUniqueCommandRequestMock,
  infoMock,
  warnMock,
  errorMock,
} = vi.hoisted(() => ({
  enqueueJobMock: vi.fn(),
  claimNextJobMock: vi.fn(),
  completeJobMock: vi.fn(),
  failJobMock: vi.fn(),
  heartbeatJobMock: vi.fn(),
  executeAndFinalizeCommandMock: vi.fn(),
  markCommandExecutionFailedMock: vi.fn(),
  findUniqueCommandRequestMock: vi.fn(),
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
    commandRequest: {
      findUnique: findUniqueCommandRequestMock,
    },
  },
}));

vi.mock("./service-execution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service-execution")>();
  return {
    ...actual,
    executeAndFinalizeCommand: executeAndFinalizeCommandMock,
    markCommandExecutionFailed: markCommandExecutionFailedMock,
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
  COMMAND_EXECUTION_JOB_TYPE,
  enqueueCommandExecutionJob,
  parseCommandExecutionJobPayload,
  runCommandExecutionJobWorkerOnce,
  startCommandExecutionWorker,
  stopCommandExecutionWorkerForTests,
} from "./execution-worker";

function makeJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "job-cmd-1",
    type: COMMAND_EXECUTION_JOB_TYPE,
    payload: {
      commandRequestId: "req-1",
      summary: "test",
      requestedAt: new Date().toISOString(),
    } as Prisma.JsonValue,
    attempts: 1,
    maxAttempts: 1,
    ...overrides,
  };
}

describe("command execution durable job worker", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    enqueueJobMock.mockResolvedValue({ id: "job-cmd-enqueued" });
    claimNextJobMock.mockResolvedValue(null);
    completeJobMock.mockResolvedValue({ count: 1 });
    failJobMock.mockResolvedValue({ count: 1 });
    heartbeatJobMock.mockResolvedValue({ count: 1 });
    findUniqueCommandRequestMock.mockResolvedValue({
      teamId: "team_1",
      createdBy: "user_1",
    });
    executeAndFinalizeCommandMock.mockResolvedValue({
      id: "req-default",
      status: "COMPLETED",
    });
    stopCommandExecutionWorkerForTests();
  });

  describe("enqueueCommandExecutionJob", () => {
    it("enqueues a command.execution job with a normalized payload", async () => {
      const result = await enqueueCommandExecutionJob({
        commandRequestId: "  req-42 ",
        summary: "test summary",
      });

      expect(result).toEqual({ id: "job-cmd-enqueued" });
      expect(enqueueJobMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: COMMAND_EXECUTION_JOB_TYPE,
          title: "Execute command req-42",
          payload: expect.objectContaining({
            commandRequestId: "req-42",
            summary: "test summary",
            requestedAt: expect.any(String),
          }),
          maxAttempts: 1,
          teamId: "team_1",
          createdBy: "user_1",
        }),
      );
    });

    it("rejects empty commandRequestId to surface caller bugs early", async () => {
      await expect(
        enqueueCommandExecutionJob({ commandRequestId: "   ", summary: "x" }),
      ).rejects.toThrow(/commandRequestId/);
      expect(enqueueJobMock).not.toHaveBeenCalled();
    });
  });

  describe("parseCommandExecutionJobPayload", () => {
    it("throws when payload is missing the commandRequestId field", () => {
      expect(() => parseCommandExecutionJobPayload({ foo: "bar" })).toThrow(
        /commandRequestId/,
      );
    });

    it("returns the parsed commandRequestId for a well-formed payload", () => {
      const parsed = parseCommandExecutionJobPayload({
        commandRequestId: "req-1",
        summary: "ok",
      });
      expect(parsed).toEqual({
        commandRequestId: "req-1",
        summary: "ok",
        requestedAt: undefined,
      });
    });
  });

  describe("runCommandExecutionJobWorkerOnce", () => {
    it("completes the job with the commandRequest terminal status", async () => {
      claimNextJobMock.mockResolvedValueOnce(makeJob());
      executeAndFinalizeCommandMock.mockResolvedValueOnce({
        id: "req-1",
        status: "COMPLETED",
      });

      const result = await runCommandExecutionJobWorkerOnce();

      expect(result).toBe(true);
      expect(claimNextJobMock).toHaveBeenCalledWith(
        expect.objectContaining({
          types: [COMMAND_EXECUTION_JOB_TYPE],
          leaseMs: expect.any(Number),
        }),
      );
      expect(heartbeatJobMock).toHaveBeenCalledWith(
        "job-cmd-1",
        expect.stringContaining(":command-execution:"),
        expect.objectContaining({ progress: expect.stringContaining("req-1") }),
      );
      expect(executeAndFinalizeCommandMock).toHaveBeenCalledWith("req-1");
      expect(completeJobMock).toHaveBeenCalledWith(
        "job-cmd-1",
        expect.stringContaining(":command-execution:"),
        expect.objectContaining({
          commandRequestId: "req-1",
          status: "COMPLETED",
        }),
      );
      expect(failJobMock).not.toHaveBeenCalled();
    });

    it("fails the job when commandRequest ends FAILED (no false job success)", async () => {
      claimNextJobMock.mockResolvedValueOnce(makeJob());
      executeAndFinalizeCommandMock.mockResolvedValueOnce({
        id: "req-1",
        status: "FAILED",
      });

      const result = await runCommandExecutionJobWorkerOnce();

      expect(result).toBe(true);
      expect(failJobMock).toHaveBeenCalledWith(
        "job-cmd-1",
        expect.stringContaining(":command-execution:"),
        expect.stringContaining("FAILED"),
      );
      expect(completeJobMock).not.toHaveBeenCalled();
    });

    it("skips dispatch entirely when the claim returns no job", async () => {
      claimNextJobMock.mockResolvedValueOnce(null);

      const result = await runCommandExecutionJobWorkerOnce();

      expect(result).toBe(false);
      expect(heartbeatJobMock).not.toHaveBeenCalled();
      expect(executeAndFinalizeCommandMock).not.toHaveBeenCalled();
      expect(completeJobMock).not.toHaveBeenCalled();
      expect(failJobMock).not.toHaveBeenCalled();
    });

    it("marks command failed then fails job when finalize throws", async () => {
      claimNextJobMock.mockResolvedValueOnce(makeJob());
      executeAndFinalizeCommandMock.mockRejectedValueOnce(new Error("prisma down"));
      markCommandExecutionFailedMock.mockResolvedValueOnce(undefined);

      const result = await runCommandExecutionJobWorkerOnce();

      expect(result).toBe(true);
      expect(markCommandExecutionFailedMock).toHaveBeenCalledWith("req-1", expect.any(Error));
      expect(failJobMock).toHaveBeenCalledWith(
        "job-cmd-1",
        expect.stringContaining(":command-execution:"),
        expect.stringContaining("prisma down"),
      );
      expect(completeJobMock).not.toHaveBeenCalled();
      expect(errorMock).toHaveBeenCalled();
    });

    it("fails the job when the payload is malformed (cannot recover)", async () => {
      claimNextJobMock.mockResolvedValueOnce(makeJob({ payload: { foo: "bar" } as Prisma.JsonValue }));

      const result = await runCommandExecutionJobWorkerOnce();

      expect(result).toBe(true);
      expect(failJobMock).toHaveBeenCalledWith(
        "job-cmd-1",
        expect.stringContaining(":command-execution:"),
        expect.stringContaining("commandRequestId"),
      );
      expect(executeAndFinalizeCommandMock).not.toHaveBeenCalled();
    });

    it("does not overlap concurrent ticks", async () => {
      let releaseClaim!: (value: unknown) => void;
      claimNextJobMock.mockImplementationOnce(
        () => new Promise((resolve) => { releaseClaim = resolve; }),
      );

      const first = runCommandExecutionJobWorkerOnce();
      const second = await runCommandExecutionJobWorkerOnce();
      expect(second).toBe(false);
      expect(warnMock).toHaveBeenCalledWith(
        "Skipping command execution tick because a previous tick is still running",
      );

      releaseClaim(null);
      await first;
    });
  });

  describe("startCommandExecutionWorker lifecycle", () => {
    it("starts once (idempotent) and logs the workerId", async () => {
      const state = await startCommandExecutionWorker();
      const state2 = await startCommandExecutionWorker();

      expect(state).toBe(state2);
      expect(infoMock).toHaveBeenCalledWith(
        "command execution durable job worker started",
        expect.objectContaining({
          intervalMs: expect.any(Number),
          workerId: expect.stringContaining(":command-execution:"),
        }),
      );

      stopCommandExecutionWorkerForTests();
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    playbookRunFindUnique: vi.fn(),
    playbookRunUpdateMany: vi.fn(),
    acquireAdvisoryLock: vi.fn(),
    executePlaybookChain: vi.fn(),
    auditSystemAction: vi.fn(),
    heartbeatJob: vi.fn(),
    releaseLock: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    playbookRun: {
      findUnique: mocks.playbookRunFindUnique,
      updateMany: mocks.playbookRunUpdateMany,
    },
  },
}));
vi.mock("@/lib/concurrency/advisory-lock", () => ({
  acquireAdvisoryLock: mocks.acquireAdvisoryLock,
}));
vi.mock("../executor", () => ({
  executePlaybookChain: mocks.executePlaybookChain,
}));
vi.mock("@/lib/audit/service", () => ({
  auditSystemAction: mocks.auditSystemAction,
}));
vi.mock("@/lib/job/service", () => ({
  claimNextJob: vi.fn(),
  completeJob: vi.fn(),
  failJob: vi.fn(),
  heartbeatJob: mocks.heartbeatJob,
}));
vi.mock("@/lib/job/heartbeat-runner", () => ({
  runWithLeaseHeartbeat: vi.fn(async ({ run }: { run: () => Promise<unknown> }) => run()),
}));
vi.mock("@/lib/job/lease", () => ({
  computeLeaseMs: () => 30 * 60 * 1000,
}));
vi.mock("@/lib/config/env", () => ({
  config: {
    app: { hostname: "test-host" },
    worker: { playbookRunIntervalMs: 5_000 },
  },
}));

import { processPlaybookRun } from "../worker";

const playbook = {
  id: "pb1",
  name: "Cleanup",
  steps: [
    {
      id: "s1",
      name: "notify",
      type: "send_notification",
      config: { recipientUserId: "u1", subject: "s", body: "b" },
      retry: 0,
      timeoutSec: 30,
    },
  ],
  createdById: "u1",
};

describe("processPlaybookRun dual-owner races", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.releaseLock.mockResolvedValue(undefined);
    mocks.acquireAdvisoryLock.mockResolvedValue(mocks.releaseLock);
    mocks.auditSystemAction.mockResolvedValue(undefined);
    mocks.heartbeatJob.mockResolvedValue({ count: 1 });
  });

  it("skips re-execution after lock when another owner already terminalized the run", async () => {
    mocks.playbookRunFindUnique
      .mockResolvedValueOnce({
        id: "run-1",
        status: "running",
        dryRun: false,
        teamId: "team1",
        stepResults: [],
        executionState: { schemaVersion: 1, stepsSnapshot: playbook.steps },
        errorMessage: null,
        startedAt: new Date("2026-07-19T00:00:00Z"),
        createdById: "u1",
        playbook,
      })
      // post-lock re-check
      .mockResolvedValueOnce({
        status: "completed",
        errorMessage: null,
        stepResults: [{ stepId: "s1", status: "ok" }],
        dryRun: false,
        teamId: "team1",
      });
    mocks.playbookRunUpdateMany.mockResolvedValueOnce({ count: 1 }); // initial claim

    const result = await processPlaybookRun("run-1", "job-1");

    expect(result).toEqual({ status: "completed", summary: "completed" });
    expect(mocks.executePlaybookChain).not.toHaveBeenCalled();
    expect(mocks.acquireAdvisoryLock).toHaveBeenCalledWith("playbook-execute", "pb1");
    expect(mocks.releaseLock).toHaveBeenCalledTimes(1);
    expect(mocks.auditSystemAction).not.toHaveBeenCalled();
  });

  it("CAS finalize preserves cancelled written while the chain was in flight", async () => {
    mocks.playbookRunFindUnique
      .mockResolvedValueOnce({
        id: "run-1",
        status: "running",
        dryRun: false,
        teamId: "team1",
        stepResults: [],
        executionState: { schemaVersion: 1, stepsSnapshot: playbook.steps },
        errorMessage: null,
        startedAt: new Date("2026-07-19T00:00:00Z"),
        createdById: "u1",
        playbook,
      })
      .mockResolvedValueOnce({
        status: "running",
        errorMessage: null,
        stepResults: [],
        dryRun: false,
        teamId: "team1",
      })
      // after failed CAS finalize
      .mockResolvedValueOnce({
        status: "cancelled",
        errorMessage: "cancelled by operator",
      });
    mocks.playbookRunUpdateMany
      .mockResolvedValueOnce({ count: 1 }) // initial claim
      .mockResolvedValueOnce({ count: 1 }) // stillClaimable
      .mockResolvedValueOnce({ count: 0 }); // finalize lost to cancel
    mocks.executePlaybookChain.mockResolvedValue({
      results: [{ stepId: "s1", status: "ok", startedAt: "", completedAt: "", summary: "ok" }],
      summary: "completed 1/1 steps",
    });

    const result = await processPlaybookRun("run-1", "job-1");

    expect(result).toEqual({ status: "failed", summary: "cancelled by operator" });
    expect(mocks.auditSystemAction).not.toHaveBeenCalled();
    expect(mocks.playbookRunUpdateMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: { id: "run-1", status: { in: ["queued", "running"] } },
        data: expect.objectContaining({ status: "completed" }),
      }),
    );
  });

  it("returns terminal outcome when claim loses to cancel before lock", async () => {
    mocks.playbookRunFindUnique
      .mockResolvedValueOnce({
        id: "run-1",
        status: "running",
        dryRun: false,
        teamId: "team1",
        stepResults: [],
        executionState: null,
        errorMessage: null,
        startedAt: null,
        createdById: "u1",
        playbook,
      })
      .mockResolvedValueOnce({
        status: "cancelled",
        errorMessage: "cancelled",
      });
    mocks.playbookRunUpdateMany.mockResolvedValueOnce({ count: 0 });

    const result = await processPlaybookRun("run-1", "job-1");

    expect(result).toEqual({ status: "failed", summary: "cancelled" });
    expect(mocks.acquireAdvisoryLock).not.toHaveBeenCalled();
    expect(mocks.executePlaybookChain).not.toHaveBeenCalled();
  });
});

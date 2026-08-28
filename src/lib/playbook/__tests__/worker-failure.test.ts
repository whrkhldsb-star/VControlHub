import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers what the job wrapper writes to PlaybookRun when the run throws.
 *
 * The failure branch must not touch `stepResults`: it used to read the column
 * and write the same value back, which loses any progress the executor persisted
 * between the read and the write — exactly the step history an operator needs to
 * see why the run died.
 */

const { mocks } = vi.hoisted(() => ({
  mocks: {
    playbookRunFindUnique: vi.fn(),
    playbookRunUpdateMany: vi.fn(),
    acquireAdvisoryLock: vi.fn(),
    releaseLock: vi.fn(),
    executePlaybookChain: vi.fn(),
    auditSystemAction: vi.fn(),
    claimNextJob: vi.fn(),
    completeJob: vi.fn(),
    failJob: vi.fn(),
    failJobTerminal: vi.fn(),
    heartbeatJob: vi.fn(),
    loadApiTokenOwnerSession: vi.fn(),
    sessionHasPermission: vi.fn(),
    teamMemberFindUnique: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    playbookRun: {
      findUnique: mocks.playbookRunFindUnique,
      updateMany: mocks.playbookRunUpdateMany,
    },
    teamMember: { findUnique: mocks.teamMemberFindUnique },
  },
}));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: mocks.sessionHasPermission,
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
  claimNextJob: mocks.claimNextJob,
  completeJob: mocks.completeJob,
  failJob: mocks.failJob,
  failJobTerminal: mocks.failJobTerminal,
  heartbeatJob: mocks.heartbeatJob,
}));
vi.mock("@/lib/job/heartbeat-runner", () => ({
  runWithLeaseHeartbeat: vi.fn(async ({ run }: { run: () => Promise<unknown> }) => run()),
}));
vi.mock("@/lib/api-token/authorization", () => ({
  loadApiTokenOwnerSession: mocks.loadApiTokenOwnerSession,
}));
vi.mock("@/lib/job/lease", () => ({ computeLeaseMs: () => 30 * 60 * 1000 }));
vi.mock("@/lib/config/env", () => ({
  config: {
    app: { hostname: "test-host" },
    worker: { playbookRunIntervalMs: 5_000 },
  },
}));
vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { runPlaybookRunWorkerOnce, stopPlaybookRunWorkerForTests } = await import("../worker");

function claimedJob(overrides: { attempts?: number; maxAttempts?: number } = {}) {
  mocks.claimNextJob.mockResolvedValue({
    id: "job-x",
    payload: { runId: "run-x" },
    attempts: overrides.attempts ?? 1,
    maxAttempts: overrides.maxAttempts ?? 3,
  });
}

/** The run row the pre-lock read returns; the chain then throws. */
function runThatThrows(error: Error) {
  mocks.playbookRunFindUnique.mockResolvedValue({
    id: "run-x",
    status: "running",
    dryRun: false,
    teamId: "team1",
    stepResults: [{ stepId: "s1", status: "ok", startedAt: "", completedAt: "", summary: "ok" }],
    executionState: {
      schemaVersion: 1,
      stepsSnapshot: [
        {
          id: "s1",
          name: "notify",
          type: "send_notification",
          config: { recipientUserId: "u1", subject: "s", body: "b" },
          retry: 0,
          timeoutSec: 30,
        },
      ],
    },
    errorMessage: null,
    startedAt: null,
    createdById: "u1",
    playbook: {
      id: "pb1",
      name: "Cleanup",
      createdById: "u1",
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
    },
  });
  mocks.playbookRunUpdateMany.mockResolvedValue({ count: 1 });
  mocks.executePlaybookChain.mockRejectedValue(error);
}

/**
 * The status/errorMessage write the catch branch performs. Matched on
 * `completedAt`, which the claim write (also carrying `errorMessage: null`) does
 * not set — filtering on `errorMessage` alone would pick up the claim instead.
 */
function failureWrite() {
  return mocks.playbookRunUpdateMany.mock.calls
    .map((call) => call[0] as { where: Record<string, unknown>; data: Record<string, unknown> })
    .find((call) => "completedAt" in call.data && "errorMessage" in call.data);
}

describe("playbook run job failure branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopPlaybookRunWorkerForTests();
    mocks.releaseLock.mockResolvedValue(undefined);
    mocks.acquireAdvisoryLock.mockResolvedValue(mocks.releaseLock);
    mocks.auditSystemAction.mockResolvedValue(undefined);
    mocks.heartbeatJob.mockResolvedValue({ count: 1 });
    mocks.loadApiTokenOwnerSession.mockResolvedValue({ userId: "u1", roles: ["operator"] });
    mocks.sessionHasPermission.mockReturnValue(true);
    mocks.teamMemberFindUnique.mockResolvedValue({ userId: "u1" });
  });

  it("never rewrites stepResults, so executor progress cannot be lost", async () => {
    claimedJob();
    runThatThrows(new Error("ssh transport died"));

    expect(await runPlaybookRunWorkerOnce()).toBe(true);

    const write = failureWrite();
    expect(write).toBeDefined();
    // The whole point: the column is left to whatever the executor persisted.
    expect(write?.data).not.toHaveProperty("stepResults");
    // And no read-back of it either — that read is what created the race.
    for (const call of mocks.playbookRunFindUnique.mock.calls) {
      const args = call[0] as { select?: Record<string, unknown> } | undefined;
      if (args?.select && "stepResults" in args.select) {
        expect(Object.keys(args.select)).not.toEqual(["stepResults"]);
      }
    }
  });

  it("requeues the run while retries remain", async () => {
    claimedJob({ attempts: 1, maxAttempts: 3 });
    runThatThrows(new Error("transient"));

    await runPlaybookRunWorkerOnce();

    expect(failureWrite()?.data).toMatchObject({ status: "queued", completedAt: null });
    // Infrastructure throw goes through the retrying failJob, not the terminal one.
    expect(mocks.failJob).toHaveBeenCalled();
    expect(mocks.failJobTerminal).not.toHaveBeenCalled();
  });

  it("fails the run for good once attempts are exhausted", async () => {
    claimedJob({ attempts: 3, maxAttempts: 3 });
    runThatThrows(new Error("still broken"));

    await runPlaybookRunWorkerOnce();

    const write = failureWrite();
    expect(write?.data.status).toBe("failed");
    expect(write?.data.completedAt).toBeInstanceOf(Date);
  });

  it("only claims a queued/running row, so a cancel that already won is preserved", async () => {
    claimedJob();
    runThatThrows(new Error("boom"));

    await runPlaybookRunWorkerOnce();

    expect(failureWrite()?.where).toMatchObject({
      id: "run-x",
      status: { in: ["queued", "running"] },
    });
  });

  it("bounds the persisted error message", async () => {
    claimedJob();
    runThatThrows(new Error("x".repeat(5000)));

    await runPlaybookRunWorkerOnce();

    expect(String(failureWrite()?.data.errorMessage)).toHaveLength(2000);
  });
});

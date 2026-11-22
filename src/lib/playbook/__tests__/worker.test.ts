import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    playbookRunFindUnique: vi.fn(),
    alertRuleFindUnique: vi.fn(),
    serverFindFirst: vi.fn(),
    playbookFindUnique: vi.fn(),
    playbookRunUpdateMany: vi.fn(),
    acquireAdvisoryLock: vi.fn(),
    executePlaybookChain: vi.fn(),
    auditSystemAction: vi.fn(),
    heartbeatJob: vi.fn(),
    releaseLock: vi.fn(),
    loadApiTokenOwnerSession: vi.fn(),
    sessionHasPermission: vi.fn(),
    teamMemberFindUnique: vi.fn(),
    failJobTerminal: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn(async () => ["run", "run-1", "run-c", "run-x"].map((id) => ({ id, version: 1 }))),
    alertRule: { findUnique: mocks.alertRuleFindUnique },
    server: { findFirst: mocks.serverFindFirst },
    playbook: { findUnique: mocks.playbookFindUnique },
    playbookRun: {
      count: vi.fn(async () => 1),
      findUnique: mocks.playbookRunFindUnique,
      updateMany: mocks.playbookRunUpdateMany,
    },
    teamMember: {
      findUnique: mocks.teamMemberFindUnique,
    },
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
  claimNextJob: vi.fn(),
  completeJob: vi.fn(),
  failJob: vi.fn(),
  failJobTerminal: vi.fn(),
  heartbeatJob: mocks.heartbeatJob,
}));
vi.mock("@/lib/job/heartbeat-runner", async (original) => ({
  ...await original<typeof import("@/lib/job/heartbeat-runner")>(),
  runWithLeaseHeartbeat: vi.fn(async ({ run }: { run: () => Promise<unknown> }) => run()),
}));
vi.mock("@/lib/api-token/authorization", () => ({
  loadApiTokenOwnerSession: mocks.loadApiTokenOwnerSession,
  // Composes the loader as the real one does (covered against PostgreSQL elsewhere).
  loadJobOwnerSession: async (userId: string, teamId: string | null | undefined) => {
    if (teamId) return mocks.loadApiTokenOwnerSession(userId, teamId);
    const account = await mocks.loadApiTokenOwnerSession(userId);
    return account?.roles?.includes("admin") ? { ...account, currentTeamId: null } : account;
  },
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

import { PlaybookAuthorizationError, processPlaybookRun } from "../worker";

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
    // Default: requester is a valid, fully-permitted team member.
    mocks.loadApiTokenOwnerSession.mockResolvedValue({ userId: "u1", roles: ["operator"] });
    mocks.sessionHasPermission.mockReturnValue(true);
    mocks.teamMemberFindUnique.mockResolvedValue({ userId: "u1" });
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

  it.each(["alert_rule", "capacity_forecast"])("fails a queued %s run for a playbook in another customer", async (type) => {
    mocks.playbookRunFindUnique
      .mockResolvedValueOnce({
        id: "run-1", status: "queued", teamId: "team-b", startedAt: null,
        createdById: "u1", playbook, triggerContext: { type, alertRuleId: "rule-a" },
      })
      .mockResolvedValueOnce({ status: "running", dryRun: false, teamId: "team-b", stepResults: [] });
    mocks.playbookRunUpdateMany.mockResolvedValueOnce({ count: 1 });
    mocks.alertRuleFindUnique.mockResolvedValue({ teamId: "team-a" });
    mocks.playbookFindUnique.mockResolvedValue({ teamId: "team-b" });

    await expect(processPlaybookRun("run-1", "job-1")).rejects.toBeInstanceOf(PlaybookAuthorizationError);
    expect(mocks.executePlaybookChain).not.toHaveBeenCalled();
    expect(mocks.releaseLock).toHaveBeenCalledOnce();
  });

  it("stops dispatching and releases the execution lock when its connection signals loss", async () => {
    const lock = new AbortController();
    const job = new AbortController();
    const release = Object.assign(vi.fn(async () => {}), { signal: lock.signal });
    mocks.acquireAdvisoryLock.mockResolvedValueOnce(release);
    mocks.playbookRunFindUnique
      .mockResolvedValueOnce({ id: "run", status: "queued", teamId: "team1", createdById: "u1", playbook })
      .mockResolvedValueOnce({ status: "running", dryRun: false, teamId: "team1", stepResults: [] });
    mocks.playbookRunUpdateMany.mockResolvedValue({ count: 1 });
    mocks.executePlaybookChain.mockImplementationOnce(async ({ beforeDispatch }) => {
      lock.abort(new Error("connection closed"));
      await beforeDispatch();
    });
    await expect(processPlaybookRun("run", "job", job.signal, 2, 1)).rejects.toMatchObject({ name: "LeaseLostError" });
    expect(job.signal.aborted).toBe(false);
    expect(release).toHaveBeenCalledOnce();
    expect(mocks.auditSystemAction).not.toHaveBeenCalled();
  });

  it.each([
    { type: "alert_rule", hostTeamId: "other-team" },
    { type: "capacity_forecast", hostTeamId: "other-team" },
    { type: "alert_rule", hostTeamId: "team1" },
    { type: "capacity_forecast", hostTeamId: "team1" },
  ])("checks a queued platform $type against the source host's current team ($hostTeamId)", async ({ type, hostTeamId }) => {
    mocks.playbookRunFindUnique
      .mockResolvedValueOnce({
        id: "run", status: "queued", createdById: "u1", teamId: "team1", playbook,
        triggerContext: { type, alertRuleId: "platform", serverId: "host" },
      })
      .mockResolvedValueOnce({ status: "running", dryRun: false, teamId: "team1", stepResults: [] });
    mocks.playbookRunUpdateMany.mockResolvedValue({ count: 1 });
    mocks.alertRuleFindUnique.mockResolvedValueOnce({ teamId: null });
    mocks.playbookFindUnique.mockResolvedValueOnce({ teamId: "team1" });
    mocks.serverFindFirst.mockImplementationOnce(async ({ where }) =>
      where.id === "host" && where.teamId === hostTeamId ? { id: "host" } : null,
    );
    if (hostTeamId === "team1") {
      mocks.executePlaybookChain.mockResolvedValueOnce({ results: [], summary: "done" });
      await expect(processPlaybookRun("run", "job")).resolves.toMatchObject({ status: "completed" });
      expect(mocks.executePlaybookChain).toHaveBeenCalledOnce();
    } else {
      await expect(processPlaybookRun("run", "job")).rejects.toBeInstanceOf(PlaybookAuthorizationError);
      expect(mocks.executePlaybookChain).not.toHaveBeenCalled();
    }
    expect(mocks.serverFindFirst).toHaveBeenCalledWith({ where: { id: "host", teamId: "team1", enabled: true, OR: [{ teamId: null }, { team: { deletedAt: null } }] }, select: { id: true } });
  });

  it("refuses a platform run claimed after the requester became a customer member with playbook:run", async () => {
    mocks.playbookRunFindUnique.mockResolvedValueOnce({
      id: "run", status: "queued", teamId: null, createdById: "u1", playbook,
    });
    mocks.playbookRunUpdateMany.mockResolvedValueOnce({ count: 1 });
    await expect(processPlaybookRun("run", "job")).rejects.toBeInstanceOf(PlaybookAuthorizationError);
    expect(mocks.executePlaybookChain).not.toHaveBeenCalled();
  });

  it("refuses to substitute the playbook owner's admin role after a platform run's requester was deleted", async () => {
    mocks.playbookRunFindUnique.mockResolvedValueOnce({
      id: "run", status: "queued", teamId: null, createdById: null, playbook, triggerContext: { source: "manual" },
    });
    mocks.playbookRunUpdateMany.mockResolvedValueOnce({ count: 1 });
    mocks.loadApiTokenOwnerSession.mockResolvedValue({ userId: playbook.createdById, roles: ["admin"] });
    await expect(processPlaybookRun("run", "job")).rejects.toBeInstanceOf(PlaybookAuthorizationError);
    expect(mocks.loadApiTokenOwnerSession).not.toHaveBeenCalled();
    expect(mocks.executePlaybookChain).not.toHaveBeenCalled();
  });

  it.each(["alert_rule", "manual"])("refuses a %s run when the frozen actor is gone after takeover", async (type) => {
    mocks.playbookRunFindUnique.mockResolvedValueOnce({
      id: "run", status: "queued", teamId: "team1", createdById: null, playbook,
      executionState: { schemaVersion: 2, stepsSnapshot: playbook.steps, actorId: "old-owner", chainRetry: 0 },
      triggerContext: { type },
    });
    mocks.playbookRunUpdateMany.mockResolvedValueOnce({ count: 1 });
    mocks.loadApiTokenOwnerSession.mockImplementationOnce(async (id) => id === "old-owner" ? null : { roles: ["admin"] });
    await expect(processPlaybookRun("run", "job")).rejects.toBeInstanceOf(PlaybookAuthorizationError);
    expect(mocks.loadApiTokenOwnerSession).toHaveBeenCalledExactlyOnceWith("old-owner", "team1");
    expect(mocks.executePlaybookChain).not.toHaveBeenCalled();
  });

  it.each([[2, 0, 5], [2, 5, 0], [1, 2, 0]])("uses the v%i queued budget of %i after the definition changes to %i", async (schemaVersion, frozen, current) => {
    mocks.playbookRunFindUnique
      .mockResolvedValueOnce({
        id: "run", status: "queued", teamId: "team1", createdById: "u1", playbook: { ...playbook, chainRetry: current },
        executionState: { schemaVersion, stepsSnapshot: playbook.steps, ...(schemaVersion === 2 ? { chainRetry: frozen, actorId: "u1" } : {}) },
      })
      .mockResolvedValueOnce({ status: "running", dryRun: false, teamId: "team1", stepResults: [] });
    mocks.playbookRunUpdateMany.mockResolvedValue({ count: 1 });
    mocks.executePlaybookChain.mockResolvedValueOnce({ results: [], summary: "done" });
    await processPlaybookRun("run", "job", undefined, frozen + 1);
    expect(mocks.executePlaybookChain).toHaveBeenCalledWith(expect.objectContaining({ playbook: expect.objectContaining({ chainRetry: frozen }) }));
  });

  it.each([null, { teamId: null }])("rechecks a deleted or reassigned alert rule before the next dispatch (%j)", async (changed) => {
    mocks.playbookRunFindUnique
      .mockResolvedValueOnce({
        id: "run", status: "queued", teamId: "team1", createdById: "u1", playbook,
        executionState: { schemaVersion: 2, stepsSnapshot: playbook.steps, actorId: "u1", chainRetry: 1, sourceRuleTeamId: "team1" },
        triggerContext: { type: "alert_rule", alertRuleId: "rule", serverId: "host" },
      })
      .mockResolvedValueOnce({ status: "running", dryRun: false, teamId: "team1", stepResults: [] });
    mocks.playbookRunUpdateMany.mockResolvedValue({ count: 1 });
    mocks.alertRuleFindUnique.mockResolvedValueOnce({ teamId: "team1" }).mockResolvedValueOnce({ teamId: "team1" }).mockResolvedValueOnce(changed);
    mocks.playbookFindUnique.mockResolvedValue({ teamId: "team1" });
    mocks.serverFindFirst.mockResolvedValue({ id: "host" });
    const dispatch = vi.fn();
    mocks.executePlaybookChain.mockImplementationOnce(async ({ beforeDispatch }) => {
      for (let step = 0; step < 2; step++) { await beforeDispatch(); dispatch(step); }
      return { results: [], summary: "done" };
    });
    await expect(processPlaybookRun("run", "job")).rejects.toBeInstanceOf(PlaybookAuthorizationError);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("reloads the platform role before dispatch after the worker has claimed the run", async () => {
    mocks.playbookRunFindUnique
      .mockResolvedValueOnce({ id: "run", status: "queued", teamId: null, createdById: "u1", playbook })
      .mockResolvedValueOnce({ status: "running", dryRun: false, teamId: null, stepResults: [] });
    mocks.playbookRunUpdateMany.mockResolvedValue({ count: 1 });
    mocks.loadApiTokenOwnerSession.mockResolvedValueOnce({ userId: "u1", roles: ["admin"] });
    mocks.executePlaybookChain.mockImplementationOnce(async ({ beforeDispatch }) => {
      await beforeDispatch();
      throw new Error("demoted requester reached dispatch");
    });
    await expect(processPlaybookRun("run", "job")).rejects.toBeInstanceOf(PlaybookAuthorizationError);
    expect(mocks.executePlaybookChain).toHaveBeenCalledOnce();
    expect(mocks.loadApiTokenOwnerSession).toHaveBeenCalledTimes(2);
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
        where: { id: "run-1", version: 1, status: { in: ["queued", "running"] } },
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

  it("reconstructs the webhook audit error from the snapshot and numeric receipt", async () => {
    const url = "https://example.com/secret-path?token=private";
    const step = { id: "hook", type: "call_webhook", config: { method: "POST", url } };
    mocks.playbookRunFindUnique
      .mockResolvedValueOnce({
        id: "run-1", status: "running", createdById: "u1", teamId: "team1", playbook,
        executionState: { schemaVersion: 1, stepsSnapshot: [step] },
      })
      .mockResolvedValueOnce({ status: "running", dryRun: false, stepResults: [], teamId: "team1" });
    mocks.playbookRunUpdateMany.mockResolvedValue({ count: 1 });
    mocks.executePlaybookChain.mockResolvedValue({
      results: [{ stepId: "hook", status: "failed", error: `POST ${url} returned 500`, httpStatus: 500 }],
      summary: "completed 0/1 steps, 1 failed",
    });
    await processPlaybookRun("run-1", "job-1");
    const failedError = "webhook step hook POST example.com: HTTP 500";
    expect(mocks.auditSystemAction).toHaveBeenCalledWith("playbook.run.failed", expect.objectContaining({ failedStepId: "hook", failedError }), "WARNING", "team1");
    expect(JSON.stringify([mocks.auditSystemAction.mock.calls, mocks.playbookRunUpdateMany.mock.calls])).not.toMatch(/secret-path|token=/);
    expect(mocks.playbookRunUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "failed", errorMessage: failedError,
        stepResults: [expect.objectContaining({ status: "failed", error: failedError })],
      }),
    }));
  });

  it("does not forward a historical terminal webhook error into the reclaimed job", async () => {
    mocks.playbookRunFindUnique.mockResolvedValueOnce({
      status: "failed", errorMessage: "webhook POST https://example.com/secret-path?token=private returned 500",
    });
    await expect(processPlaybookRun("run-1", "job-1")).resolves.toEqual({ status: "failed", summary: "failed" });
    expect(mocks.executePlaybookChain).not.toHaveBeenCalled();
  });
});

describe("processPlaybookRun command-step live authorization", () => {
  const commandPlaybook = {
    id: "pb-cmd",
    name: "Restart",
    steps: [
      {
        id: "c1",
        name: "restart",
        type: "run_command",
        config: { serverId: "srv1", command: "systemctl restart nginx" },
        retry: 0,
        timeoutSec: 30,
      },
    ],
    createdById: "u1",
  };

  function claimedCommandRun(dryRun = false) {
    mocks.playbookRunFindUnique.mockResolvedValueOnce({
      id: "run-c",
      status: "running",
      dryRun,
      teamId: "team1",
      stepResults: [],
      executionState: { schemaVersion: 1, stepsSnapshot: commandPlaybook.steps },
      errorMessage: null,
      startedAt: null,
      createdById: "u1",
      playbook: commandPlaybook,
    });
    mocks.playbookRunUpdateMany.mockResolvedValueOnce({ count: 1 }); // initial claim
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.releaseLock.mockResolvedValue(undefined);
    mocks.acquireAdvisoryLock.mockResolvedValue(mocks.releaseLock);
    mocks.auditSystemAction.mockResolvedValue(undefined);
    mocks.heartbeatJob.mockResolvedValue({ count: 1 });
    mocks.loadApiTokenOwnerSession.mockResolvedValue({ userId: "u1", roles: ["operator"] });
    mocks.sessionHasPermission.mockReturnValue(true);
    mocks.teamMemberFindUnique.mockResolvedValue({ userId: "u1" });
  });

  it("terminal-fails (throws PlaybookAuthorizationError) when the requester is disabled", async () => {
    claimedCommandRun();
    mocks.loadApiTokenOwnerSession.mockResolvedValue(null);

    await expect(processPlaybookRun("run-c", "job-c")).rejects.toMatchObject({
      name: "PlaybookAuthorizationError",
    });
    // Must not dispatch the command chain nor take the per-playbook lock.
    expect(mocks.acquireAdvisoryLock).not.toHaveBeenCalled();
    expect(mocks.executePlaybookChain).not.toHaveBeenCalled();
  });

  it("terminal-fails when the requester lost command:execute", async () => {
    claimedCommandRun();
    mocks.sessionHasPermission.mockImplementation((_s: unknown, perm: string) => perm !== "command:execute");

    await expect(processPlaybookRun("run-c", "job-c")).rejects.toMatchObject({
      name: "PlaybookAuthorizationError",
    });
    expect(mocks.executePlaybookChain).not.toHaveBeenCalled();
  });

  it("allows the command plan to be previewed without command:execute", async () => {
    claimedCommandRun(true);
    mocks.sessionHasPermission.mockImplementation((_s: unknown, perm: string) => perm !== "command:execute");
    mocks.playbookRunFindUnique.mockResolvedValueOnce({ status: "running", dryRun: true, teamId: "team1", stepResults: [] });
    mocks.playbookRunUpdateMany.mockResolvedValue({ count: 1 });
    mocks.executePlaybookChain.mockResolvedValueOnce({ results: [], summary: "preview" });
    await expect(processPlaybookRun("run-c", "job-c")).resolves.toEqual({ status: "completed", summary: "preview" });
    expect(mocks.executePlaybookChain).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it("terminal-fails when the requester is no longer a member of the run's team", async () => {
    claimedCommandRun();
    // Account remains valid, but the target-workspace session cannot load.
    mocks.sessionHasPermission.mockImplementation((_s: unknown, perm: string) => perm !== "team:manage");
    mocks.loadApiTokenOwnerSession.mockResolvedValueOnce({ userId: "u1", roles: ["operator"] }).mockResolvedValueOnce(null);

    await expect(processPlaybookRun("run-c", "job-c")).rejects.toMatchObject({
      name: "PlaybookAuthorizationError",
    });
    expect(mocks.loadApiTokenOwnerSession).toHaveBeenCalledWith("u1", "team1");
    expect(mocks.executePlaybookChain).not.toHaveBeenCalled();
  });

  it("executes when the requester still qualifies", async () => {
    claimedCommandRun();
    // post-lock re-check + stillClaimable
    mocks.playbookRunFindUnique.mockResolvedValueOnce({
      status: "running",
      errorMessage: null,
      stepResults: [],
      dryRun: false,
      teamId: "team1",
    });
    mocks.playbookRunUpdateMany
      .mockResolvedValueOnce({ count: 1 }) // stillClaimable
      .mockResolvedValueOnce({ count: 1 }); // finalize
    mocks.executePlaybookChain.mockResolvedValue({
      results: [{ stepId: "c1", status: "ok", startedAt: "", completedAt: "", summary: "ok" }],
      summary: "completed 1/1 steps",
    });

    const result = await processPlaybookRun("run-c", "job-c");

    expect(result).toEqual({ status: "completed", summary: "completed 1/1 steps" });
    expect(mocks.executePlaybookChain).toHaveBeenCalledTimes(1);
  });

  it("throws when a command step exists but there is no requester", async () => {
    mocks.playbookRunFindUnique.mockResolvedValueOnce({
      id: "run-c",
      status: "running",
      dryRun: false,
      teamId: "team1",
      stepResults: [],
      executionState: { schemaVersion: 1, stepsSnapshot: commandPlaybook.steps },
      errorMessage: null,
      startedAt: null,
      createdById: null,
      playbook: { ...commandPlaybook, createdById: null },
    });
    mocks.playbookRunUpdateMany.mockResolvedValueOnce({ count: 1 });

    await expect(processPlaybookRun("run-c", "job-c")).rejects.toThrow();
    expect(mocks.executePlaybookChain).not.toHaveBeenCalled();
  });
});

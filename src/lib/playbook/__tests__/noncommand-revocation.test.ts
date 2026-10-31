import { expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    playbookRunFindUnique: vi.fn(),
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
    playbookRun: {
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
vi.mock("@/lib/job/heartbeat-runner", () => ({
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


it("refuses webhook-only runs whose owner is no longer active", async () => {
  const hook = { id: "hook", type: "call_webhook", name: "hook", config: { url: "https://example.invalid/test", method: "POST" }, timeoutSec: 30, retry: 0 };
  const row = { id: "run", status: "queued", dryRun: false, teamId: "team", stepResults: [], executionState: { schemaVersion: 1, stepsSnapshot: [hook] }, createdById: "disabled-user", playbook: { ...playbook, steps: [hook] } };
  mocks.playbookRunFindUnique.mockResolvedValue(row);
  mocks.playbookRunUpdateMany.mockResolvedValue({ count: 1 });
  mocks.acquireAdvisoryLock.mockResolvedValue(async () => {});
  mocks.loadApiTokenOwnerSession.mockResolvedValue(null);
  mocks.executePlaybookChain.mockResolvedValue({ results: [{ stepId: "hook", status: "ok" }], summary: "done" });
  await expect(processPlaybookRun("run", "job")).rejects.toThrow();
  expect(mocks.executePlaybookChain).not.toHaveBeenCalled();
  expect(mocks.loadApiTokenOwnerSession).toHaveBeenCalled();
});

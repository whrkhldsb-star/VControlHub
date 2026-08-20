import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerHealth } from "@/lib/health/service-types";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    playbookFindMany: vi.fn(),
    playbookFindUnique: vi.fn(),
    playbookUpdateMany: vi.fn(),
    playbookUpdate: vi.fn(),
    serverFindMany: vi.fn(),
    transaction: vi.fn(),
    tryAcquireAdvisoryLock: vi.fn(),
    releaseLock: vi.fn(),
    queuePlaybookRunWithClient: vi.fn(),
    auditSystemAction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    playbook: {
      findMany: mocks.playbookFindMany,
      findUnique: mocks.playbookFindUnique,
      updateMany: mocks.playbookUpdateMany,
      update: mocks.playbookUpdate,
    },
    server: { findMany: mocks.serverFindMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/concurrency/advisory-lock", () => ({
  tryAcquireAdvisoryLock: mocks.tryAcquireAdvisoryLock,
}));
vi.mock("@/lib/audit/service", () => ({ auditSystemAction: mocks.auditSystemAction }));
vi.mock("../run-queue", () => ({ queuePlaybookRunWithClient: mocks.queuePlaybookRunWithClient }));

import {
  dispatchDueCronPlaybook,
  dispatchMetricPlaybooksForHealthOverview,
  initializeCronPlaybookSchedule,
} from "../trigger-service";

const dueAt = new Date("2026-08-20T19:00:00.000Z"); // 03:00 Asia/Shanghai
const now = new Date("2026-08-20T19:00:10.000Z");

function cronPlaybook(overrides: Record<string, unknown> = {}) {
  return {
    id: "pb-cron",
    name: "Nightly cleanup",
    triggerType: "cron",
    triggerConfig: { expression: "0 3 * * *" },
    steps: [],
    chainRetry: 0,
    enabled: true,
    nextRunAt: dueAt,
    lastTriggeredAt: null,
    metricMatchState: null,
    createdById: "user-1",
    teamId: "team-1",
    ...overrides,
  };
}

function metricPlaybook(metricMatchState: unknown = null) {
  return {
    id: "pb-metric",
    name: "CPU remediation",
    triggerType: "metric",
    triggerConfig: { metric: "cpu_usage", operator: "gt", threshold: 80 },
    steps: [],
    chainRetry: 0,
    enabled: true,
    nextRunAt: null,
    lastTriggeredAt: null,
    metricMatchState,
    createdById: "user-1",
    teamId: "team-1",
  };
}

describe("Playbook automatic trigger dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.releaseLock.mockResolvedValue(undefined);
    mocks.tryAcquireAdvisoryLock.mockResolvedValue(mocks.releaseLock);
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      playbook: {
        findUnique: mocks.playbookFindUnique,
        updateMany: mocks.playbookUpdateMany,
        update: mocks.playbookUpdate,
      },
    }));
    mocks.playbookUpdateMany.mockResolvedValue({ count: 1 });
    mocks.playbookUpdate.mockResolvedValue({});
    mocks.queuePlaybookRunWithClient.mockResolvedValue({ created: true, run: { id: "run-1" } });
    mocks.auditSystemAction.mockResolvedValue(undefined);
  });

  it("initializes a legacy Cron playbook without replaying historical occurrences", async () => {
    mocks.playbookFindUnique.mockResolvedValue(cronPlaybook({ nextRunAt: null }));

    await expect(initializeCronPlaybookSchedule("pb-cron", now)).resolves.toBe(true);

    expect(mocks.playbookUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "pb-cron", nextRunAt: null }),
      data: { nextRunAt: new Date("2026-08-21T19:00:00.000Z") },
    }));
    expect(mocks.queuePlaybookRunWithClient).not.toHaveBeenCalled();
  });

  it("atomically advances a due Cron schedule and queues one occurrence", async () => {
    mocks.playbookFindUnique.mockResolvedValue(cronPlaybook());

    const result = await dispatchDueCronPlaybook({ playbookId: "pb-cron", dueAt, now });

    expect(result).toEqual({ dispatched: true, advanced: true });
    expect(mocks.playbookUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "pb-cron", nextRunAt: dueAt }),
      data: {
        nextRunAt: new Date("2026-08-21T19:00:00.000Z"),
        lastTriggeredAt: now,
      },
    }));
    expect(mocks.queuePlaybookRunWithClient).toHaveBeenCalledWith(expect.objectContaining({
      triggerKey: "cron:0 3 * * *:2026-08-20T19:00:00.000Z",
      triggerContext: expect.objectContaining({
        type: "cron",
        scheduledFor: "2026-08-20T19:00:00.000Z",
        timeZone: "Asia/Shanghai",
      }),
    }));
    expect(mocks.auditSystemAction).toHaveBeenCalledWith(
      "playbook.trigger.cron",
      expect.objectContaining({ runId: "run-1" }),
      "INFO",
    );
  });

  it("does not queue a Cron run after a concurrent schedule change", async () => {
    mocks.playbookFindUnique.mockResolvedValue(cronPlaybook({ nextRunAt: new Date("2026-08-21T19:00:00.000Z") }));

    await expect(dispatchDueCronPlaybook({ playbookId: "pb-cron", dueAt, now })).resolves.toEqual({
      dispatched: false,
      advanced: false,
    });
    expect(mocks.queuePlaybookRunWithClient).not.toHaveBeenCalled();
  });

  it("fires a metric Playbook only on the threshold edge and resets after recovery", async () => {
    let persistedState: unknown = null;
    mocks.playbookFindMany.mockResolvedValue([{ id: "pb-metric", teamId: "team-1" }]);
    mocks.serverFindMany.mockResolvedValue([{ id: "srv-1", teamId: "team-1" }]);
    mocks.playbookFindUnique.mockImplementation(() => metricPlaybook(persistedState));
    mocks.playbookUpdate.mockImplementation(async ({ data }: { data: { metricMatchState?: unknown } }) => {
      if (data.metricMatchState !== undefined) persistedState = data.metricMatchState;
      return metricPlaybook(persistedState);
    });

    const high: ServerHealth[] = [{
      serverId: "srv-1",
      serverName: "Node 1",
      host: "10.0.0.1",
      enabled: true,
      status: "warning" as const,
      cpu: 91,
      lastCheck: "2026-08-20T19:00:00.000Z",
    }];
    const normal: ServerHealth[] = [{
      serverId: "srv-1",
      serverName: "Node 1",
      host: "10.0.0.1",
      enabled: true,
      status: "healthy",
      cpu: 45,
      lastCheck: "2026-08-20T19:05:00.000Z",
    }];
    const highAgain: ServerHealth[] = [{
      serverId: "srv-1",
      serverName: "Node 1",
      host: "10.0.0.1",
      enabled: true,
      status: "warning",
      cpu: 91,
      lastCheck: "2026-08-20T19:10:00.000Z",
    }];

    await expect(dispatchMetricPlaybooksForHealthOverview(high, now)).resolves.toEqual({ dispatched: 1, evaluated: 1 });
    await expect(dispatchMetricPlaybooksForHealthOverview(high, new Date("2026-08-20T19:01:00.000Z"))).resolves.toEqual({ dispatched: 0, evaluated: 1 });
    await expect(dispatchMetricPlaybooksForHealthOverview(normal, new Date("2026-08-20T19:05:10.000Z"))).resolves.toEqual({ dispatched: 0, evaluated: 1 });
    await expect(dispatchMetricPlaybooksForHealthOverview(highAgain, new Date("2026-08-20T19:10:10.000Z"))).resolves.toEqual({ dispatched: 1, evaluated: 1 });

    expect(mocks.queuePlaybookRunWithClient).toHaveBeenCalledTimes(2);
    expect(mocks.queuePlaybookRunWithClient).toHaveBeenLastCalledWith(expect.objectContaining({
      triggerContext: expect.objectContaining({
        type: "metric",
        readings: [{ serverId: "srv-1", value: 91, sampleAt: "2026-08-20T19:10:00.000Z" }],
      }),
    }));
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: { workerRuntime: { findMany: findManyMock } },
}));

vi.mock("@/lib/workers/registry", () => ({
  getWorkerDefinitions: () => [
    { id: "backup", label: "Backup", jobType: "backup.create" },
    { id: "scheduled-task", label: "Scheduled task", jobType: "scheduled-task.tick" },
  ],
}));

import { getWorkerRuntimeHealth } from "@/lib/workers/runtime-health";

const now = new Date("2026-07-29T12:00:00.000Z");

describe("getWorkerRuntimeHealth", () => {
  beforeEach(() => findManyMock.mockReset());

  it("reports recent running, missing, stale, and failed runtimes accurately", async () => {
    findManyMock.mockResolvedValue([
      {
        workerId: "backup",
        instanceId: "host:42",
        status: "RUNNING",
        startedAt: new Date("2026-07-29T11:55:00.000Z"),
        lastHeartbeatAt: new Date("2026-07-29T11:59:45.000Z"),
        lastError: null,
      },
    ]);
    let result = await getWorkerRuntimeHealth(now);
    expect(result[0]).toMatchObject({ id: "backup", started: true, healthy: true, status: "RUNNING" });
    expect(result[1]).toMatchObject({ id: "scheduled-task", started: false, status: "MISSING" });

    findManyMock.mockResolvedValueOnce([
      {
        workerId: "backup",
        instanceId: "host:41",
        status: "RUNNING",
        startedAt: new Date("2026-07-29T11:00:00.000Z"),
        lastHeartbeatAt: new Date("2026-07-29T11:58:59.000Z"),
        lastError: null,
      },
    ]);
    result = await getWorkerRuntimeHealth(now);
    expect(result[0]).toMatchObject({ started: false, healthy: false, status: "STALE" });

    findManyMock.mockResolvedValueOnce([
      {
        workerId: "backup",
        instanceId: "host:42",
        status: "FAILED",
        startedAt: now,
        lastHeartbeatAt: now,
        lastError: "disk full",
      },
    ]);
    result = await getWorkerRuntimeHealth(now);
    expect(result[0]).toMatchObject({ started: false, status: "FAILED", lastError: "disk full" });
  });
});

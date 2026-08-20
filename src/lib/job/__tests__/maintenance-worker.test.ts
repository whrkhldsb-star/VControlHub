import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  recoverStaleRunningJobs: vi.fn(async (
    _options: { staleBefore: Date; heartbeatStaleBefore?: Date },
  ): Promise<{ count: number; recovered: string[]; failed: string[] }> => ({
    count: 0,
    recovered: [],
    failed: [],
  })),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    job: {
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("@/lib/config/env", () => ({
  config: { app: { hostname: "test-host" } },
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/job/service", () => ({
  recoverStaleRunningJobs: mocks.recoverStaleRunningJobs,
}));

vi.mock("@/lib/job/events", () => ({
  pruneJobEvents: vi.fn(async () => ({ count: 0 })),
}));

const {
  abandonOrphanPendingJobs,
  _knownJobTypesForTests,
  startJobMaintenanceWorker,
  stopJobMaintenanceWorkerForTests,
} = await import("../maintenance-worker");

describe("abandonOrphanPendingJobs", () => {
  beforeEach(() => {
    mocks.findMany.mockReset();
    mocks.updateMany.mockReset();
    mocks.recoverStaleRunningJobs.mockReset();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.recoverStaleRunningJobs.mockResolvedValue({ count: 0, recovered: [], failed: [] });
  });

  it("cancels unknown job types after soft timeout", async () => {
    mocks.findMany.mockResolvedValueOnce([
      { id: "j1", type: "playbook.command", createdAt: new Date(Date.now() - 2 * 24 * 3600_000), title: "orphan" },
      { id: "j2", type: "playbook.run", createdAt: new Date(Date.now() - 2 * 24 * 3600_000), title: "known" },
    ]);

    const result = await abandonOrphanPendingJobs({ olderThanMs: 24 * 3600_000, hardOrphanMs: 7 * 24 * 3600_000 });
    expect(result.cancelled).toBe(1);
    expect(result.ids).toEqual(["j1"]);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "j1", status: "PENDING" },
        data: expect.objectContaining({
          status: "CANCELLED",
          errorMessage: expect.stringContaining("no consumer"),
        }),
      }),
    );
  });

  it("cancels known types only after hard orphan window", async () => {
    mocks.findMany.mockResolvedValueOnce([
      { id: "j3", type: "playbook.run", createdAt: new Date(Date.now() - 8 * 24 * 3600_000), title: "ancient" },
    ]);
    const result = await abandonOrphanPendingJobs({ olderThanMs: 24 * 3600_000, hardOrphanMs: 7 * 24 * 3600_000 });
    expect(result.cancelled).toBe(1);
    expect(result.ids).toEqual(["j3"]);
  });

  it("exposes known job types helper", () => {
    expect(_knownJobTypesForTests().has("playbook.run")).toBe(true);
    expect(_knownJobTypesForTests().has("playbook.trigger.tick")).toBe(true);
  });

  // Drift guard: KNOWN_JOB_TYPES is maintained by hand (importing
  // WORKER_REGISTRY here would create a cycle), so a renamed/typo'd job type
  // silently turns real jobs into "orphan type" rows that get CANCELLED after
  // 24h. `quick_service.lifecycle` was mis-spelled with a hyphen exactly this
  // way. Scan the source for every declared job-type constant instead.
  it("covers every *_JOB_TYPE constant declared in the source tree", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join, resolve } = await import("node:path");

    const srcRoot = resolve(__dirname, "../../..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "__tests__") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(full);
      }
    };
    walk(srcRoot);

    const declared = new Set<string>();
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/_JOB_TYPE(?:_[A-Z]+)?\s*=\s*"([a-z0-9._-]+)"/g)) {
        if (match[1]) declared.add(match[1]);
      }
    }

    expect(declared.size).toBeGreaterThan(10);
    const known = _knownJobTypesForTests();
    const missing = [...declared].filter((type) => !known.has(type)).sort();
    expect(missing).toEqual([]);
  });

  it("startup tick also recovers stale RUNNING leases", async () => {
    mocks.findMany.mockResolvedValueOnce([]);
    mocks.recoverStaleRunningJobs.mockResolvedValueOnce({
      count: 1,
      recovered: ["stale-a"],
      failed: [],
    });
    await startJobMaintenanceWorker({ intervalMs: 60_000 });
    // Allow the fire-and-forget startup tick to settle.
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.recoverStaleRunningJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        staleBefore: expect.any(Date),
        heartbeatStaleBefore: expect.any(Date),
      }),
    );
    const recoveryOptions = mocks.recoverStaleRunningJobs.mock.calls[0]?.[0];
    expect(recoveryOptions?.heartbeatStaleBefore).toBeInstanceOf(Date);
    if (!recoveryOptions?.heartbeatStaleBefore) throw new Error("missing heartbeat fallback cutoff");
    expect(
      recoveryOptions.staleBefore.getTime() - recoveryOptions.heartbeatStaleBefore.getTime(),
    ).toBe(6 * 60 * 60 * 1000);
    stopJobMaintenanceWorkerForTests();
  });
});

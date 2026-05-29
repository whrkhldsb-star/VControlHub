import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    commandRequest: { findMany: vi.fn() },
    scheduledTask: { findMany: vi.fn() },
    downloadTask: { findMany: vi.fn() },
    syncJob: { findMany: vi.fn() },
    backupRecord: { findMany: vi.fn() },
    deploymentRun: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { listOperationTasks } = await import("../service");

describe("operation task service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.commandRequest.findMany.mockResolvedValue([
      { id: "cmd1", title: "重启服务", status: "PENDING_APPROVAL", createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"), requester: { username: "alice", displayName: null } },
    ]);
    mockPrisma.scheduledTask.findMany.mockResolvedValue([]);
    mockPrisma.downloadTask.findMany.mockResolvedValue([
      { id: "dl1", url: "https://example.com/a.iso", status: "RUNNING", createdAt: new Date("2026-01-02T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"), fileName: "a.iso", progress: "50%", creator: null },
    ]);
    mockPrisma.syncJob.findMany.mockResolvedValue([]);
    mockPrisma.backupRecord.findMany.mockResolvedValue([]);
    mockPrisma.deploymentRun.findMany.mockResolvedValue([]);
  });

  it("aggregates existing command/download/sync/scheduled jobs into a unified recent task list", async () => {
    const tasks = await listOperationTasks({ limit: 10 });

    expect(tasks.map((task) => task.id)).toEqual(["download:dl1", "command:cmd1"]);
    expect(tasks[0]).toMatchObject({ source: "download", status: "running", progress: "50%" });
    expect(tasks[1]).toMatchObject({ source: "command", status: "pending" });
  });

  it("maps active deployment command requests as running operation tasks", async () => {
    mockPrisma.commandRequest.findMany.mockResolvedValue([]);
    mockPrisma.downloadTask.findMany.mockResolvedValue([]);
    mockPrisma.deploymentRun.findMany.mockResolvedValue([
      {
        id: "dep_running",
        status: "PENDING",
        createdAt: new Date("2026-01-03T00:00:00Z"),
        updatedAt: new Date("2026-01-03T00:00:00Z"),
        template: { name: "Deploy app" },
        creator: { username: "ops", displayName: null },
        commandRequest: { status: "APPROVED" },
      },
    ]);

    const tasks = await listOperationTasks({ limit: 10 });

    expect(tasks).toEqual([
      expect.objectContaining({
        id: "deployment:dep_running",
        source: "deployment",
        title: "Deploy app",
        status: "running",
        actor: "ops",
        href: "/deployments",
      }),
    ]);
  });
});

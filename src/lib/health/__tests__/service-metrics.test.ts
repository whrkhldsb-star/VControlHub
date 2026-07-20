import { beforeEach, describe, expect, it, vi } from "vitest";

const createMany = vi.fn();
const serverFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    metricSnapshot: {
      createMany,
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    server: {
      findMany: serverFindMany,
      findUnique: vi.fn(),
    },
  },
}));

const { snapshotHealthOverview } = await import("../service-metrics");

describe("snapshotHealthOverview", () => {
  beforeEach(() => {
    createMany.mockReset();
    createMany.mockResolvedValue({ count: 2 });
    serverFindMany.mockReset();
    serverFindMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
      (where.id.in ?? []).map((id: string) => ({ id, teamId: null })),
    );
  });

  it("records offline hosts as isOnline=false", async () => {
    await snapshotHealthOverview({
      total: 1,
      online: 0,
      warning: 0,
      critical: 0,
      offline: 1,
      servers: [
        {
          serverId: "s1",
          serverName: "a",
          host: "1.1.1.1",
          enabled: true,
          status: "offline",
          lastCheck: new Date().toISOString(),
          error: "Network unreachable",
        },
      ],
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ serverId: "s1", cpuUsage: 0, memUsage: 0, diskUsage: 0, isOnline: false, teamId: null }],
    });
  });

  it("records SSH-auth warning hosts as isOnline=false instead of omitting them", async () => {
    await snapshotHealthOverview({
      total: 1,
      online: 0,
      warning: 1,
      critical: 0,
      offline: 0,
      servers: [
        {
          serverId: "s11",
          serverName: "11",
          host: "154.196.139.44",
          enabled: true,
          status: "warning",
          lastCheck: new Date().toISOString(),
          error: "SSH unreachable: All configured authentication methods failed",
        },
      ],
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ serverId: "s11", cpuUsage: 0, memUsage: 0, diskUsage: 0, isOnline: false, teamId: null }],
    });
  });

  it("keeps metric samples for healthy hosts", async () => {
    await snapshotHealthOverview({
      total: 1,
      online: 1,
      warning: 0,
      critical: 0,
      offline: 0,
      servers: [
        {
          serverId: "s2",
          serverName: "ok",
          host: "2.2.2.2",
          enabled: true,
          status: "healthy",
          cpu: 12,
          mem: 34,
          diskMax: 50,
          lastCheck: new Date().toISOString(),
        },
      ],
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ serverId: "s2", cpuUsage: 12, memUsage: 34, diskUsage: 50, isOnline: true, teamId: null }],
    });
  });
});

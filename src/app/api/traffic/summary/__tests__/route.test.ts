import { describe, expect, it, vi } from "vitest";

const { requireApiPermissionMock } = vi.hoisted(() => ({
  requireApiPermissionMock: vi.fn(async () => ({
    session: { userId: "u1", roles: ["viewer"] },
  })),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    storageNode: {
      findMany: vi.fn(async () => [
        {
          id: "local-storage",
          name: "Local storage",
          driver: "LOCAL",
          serverId: null,
          server: null,
          host: null,
          port: null,
          healthStatus: "HEALTHY",
        },
        {
          id: "bound-sftp",
          name: "Bound SFTP",
          driver: "SFTP",
          serverId: "srv",
          server: { id: "srv", name: "host", host: "127.0.0.1", port: 22 },
          host: "127.0.0.1",
          port: 22,
          healthStatus: "HEALTHY",
        },
        {
          id: "bare-sftp",
          name: "Standalone SFTP",
          driver: "SFTP",
          serverId: null,
          server: null,
          host: "10.0.0.8",
          port: 2022,
          healthStatus: "UNKNOWN",
        },
      ]),
    },
    server: {
      findMany: vi.fn(async () => [
        { id: "srv", name: "host", host: "127.0.0.1", port: 22 },
      ]),
    },
  },
}));

// Mock the sampler, not node:fs: on Windows the route reads adapter counters
// through PowerShell (no /proc/net/dev), so a fs-level mock makes this suite
// depend on the CI runner's real network adapters and process-spawn timing.
vi.mock("@/lib/monitoring/local-network", () => ({
  readLocalNetworkDeviceStats: vi.fn(() => [
    { iface: "eth0", rxBytes: 4096, txBytes: 8192 },
  ]),
}));

import { GET } from "../route";

describe("traffic summary route", () => {
  it("summarizes primary interface once per request (no mid-request cache advance)", async () => {
    const req = new Request(
      "http://localhost/api/traffic/summary",
    ) as Parameters<typeof GET>[0];
    const first = await (await GET(req)).json();
    const second = await (await GET(req)).json();
    // After first sample previous cache is warm; second request still has a primary iface object.
    expect(first.currentServer.primaryInterface?.iface).toEqual(expect.any(String));
    expect(second.currentServer.primaryInterface?.iface).toBe(first.currentServer.primaryInterface?.iface);
    // Rate fields exist (may be 0 on first interval, but object is stable)
    expect(typeof second.currentServer.primaryInterface.rxRateBytesPerSecond).toBe("number");
  });

  it("returns current server traffic and storage node sources", async () => {
    const req = new Request(
      "http://localhost/api/traffic/summary",
    ) as Parameters<typeof GET>[0];

    const response = await GET(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireApiPermissionMock).toHaveBeenCalledWith("server:read");
    expect(body.currentServer.primaryInterface?.iface).toEqual(expect.any(String));
    expect(body.currentServer.primaryInterface.rxLabel).toMatch(/B$/);
    expect(body.storageNodes[0]).toMatchObject({
      id: "local-storage",
      trafficSourceLabel: expect.stringMatching(/NIC|网卡/),
    });
    expect(body.storageNodes[1]).toMatchObject({
      id: "bound-sftp",
      trafficSourceLabel: expect.stringContaining("host"),
      trafficSourceDetail: expect.stringContaining("127.0.0.1:22"),
    });
    expect(body.storageNodes[2]).toMatchObject({
      id: "bare-sftp",
      trafficSourceLabel: expect.stringContaining("10.0.0.8"),
      trafficSourceDetail: expect.stringContaining("10.0.0.8:2022"),
    });
    expect(body.servers[0]).toMatchObject({ id: "srv", host: "127.0.0.1" });
  });

  it("scopes servers strictly and storage nodes loosely", async () => {
    // A viewer with no current team must not reach null-team servers: they are
    // quarantined legacy data, and with `include=remote` this route would load
    // their SSH credentials and dial out.
    const { prisma } = await import("@/lib/db");
    await GET(
      new Request("http://localhost/api/traffic/summary") as Parameters<typeof GET>[0],
    );
    expect(vi.mocked(prisma.server.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          enabled: true,
          id: "__unassigned_servers_require_team_manage__",
        },
      }),
    );
    expect(vi.mocked(prisma.storageNode.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { teamId: null } }),
    );
  });
});

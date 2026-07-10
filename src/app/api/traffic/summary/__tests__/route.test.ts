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

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(
      () => `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 10 1 0 0 0 0 0 0 20 1 0 0 0 0 0 0
  eth0: 4096 1 0 0 0 0 0 0 8192 1 0 0 0 0 0 0
`,
    ),
  };
});

import { GET } from "../route";

describe("traffic summary route", () => {
  it("returns current server traffic and storage node sources", async () => {
    const nextUrl = new URL("http://localhost/api/traffic/summary");
    // parseSearchParams reads `request.url` (Request / NextRequest contract);
    // mirror it here so the route hits the real path under test.
    const req = {
      url: nextUrl.toString(),
      nextUrl,
    } as Parameters<typeof GET>[0];

    const response = await GET(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireApiPermissionMock).toHaveBeenCalledWith("server:read");
    expect(body.currentServer.primaryInterface.iface).toBe("eth0");
    expect(body.currentServer.primaryInterface.rxLabel).toMatch(/B$/);
    expect(body.storageNodes[0]).toMatchObject({
      id: "local-storage",
      trafficSource: "current server",
      trafficSourceLabel: "current server NIC",
      trafficSourceDetail: expect.stringContaining("Using current server NIC statistics"),
    });
    expect(body.storageNodes[1]).toMatchObject({
      id: "bound-sftp",
      trafficSource: "bound server",
      trafficSourceLabel: "bound server: host",
      trafficSourceDetail: expect.stringContaining("127.0.0.1:22"),
    });
    expect(body.storageNodes[2]).toMatchObject({
      id: "bare-sftp",
      trafficSource: "Remote SFTP host",
      trafficSourceLabel: "Remote SFTP: 10.0.0.8",
      trafficSourceDetail: expect.stringContaining("10.0.0.8:2022"),
    });
    expect(body.servers[0]).toMatchObject({ id: "srv", host: "127.0.0.1" });
  });
});

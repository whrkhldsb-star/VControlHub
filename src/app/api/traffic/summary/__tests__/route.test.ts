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
          name: "本地存储",
          driver: "LOCAL",
          serverId: null,
          server: null,
          host: null,
          port: null,
          healthStatus: "HEALTHY",
        },
        {
          id: "bound-sftp",
          name: "绑定 SFTP",
          driver: "SFTP",
          serverId: "srv",
          server: { id: "srv", name: "主机", host: "127.0.0.1", port: 22 },
          host: "127.0.0.1",
          port: 22,
          healthStatus: "HEALTHY",
        },
        {
          id: "bare-sftp",
          name: "裸 SFTP",
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
        { id: "srv", name: "主机", host: "127.0.0.1", port: 22 },
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
    const req = {
      nextUrl: new URL("http://localhost/api/traffic/summary"),
    } as Parameters<typeof GET>[0];

    const response = await GET(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireApiPermissionMock).toHaveBeenCalledWith("server:read");
    expect(body.currentServer.primaryInterface.iface).toBe("eth0");
    expect(body.currentServer.primaryInterface.rxLabel).toMatch(/B$/);
    expect(body.storageNodes[0]).toMatchObject({
      id: "local-storage",
      trafficSource: "当前服务器",
      trafficSourceLabel: "当前服务器网卡",
      trafficSourceDetail: expect.stringContaining("本机流量"),
    });
    expect(body.storageNodes[1]).toMatchObject({
      id: "bound-sftp",
      trafficSource: "绑定服务器",
      trafficSourceLabel: "绑定服务器：主机",
      trafficSourceDetail: expect.stringContaining("127.0.0.1:22"),
    });
    expect(body.storageNodes[2]).toMatchObject({
      id: "bare-sftp",
      trafficSource: "远程 SFTP 主机",
      trafficSourceLabel: "远程 SFTP：10.0.0.8",
      trafficSourceDetail: expect.stringContaining("10.0.0.8:2022"),
    });
    expect(body.servers[0]).toMatchObject({ id: "srv", host: "127.0.0.1" });
  });
});

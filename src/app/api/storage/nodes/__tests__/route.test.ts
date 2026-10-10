import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireApiPermissionMock, getStorageOverviewMock, prismaMock } = vi.hoisted(() => ({
  requireApiPermissionMock: vi.fn(),
  getStorageOverviewMock: vi.fn(),
  prismaMock: {
    userStorageAccess: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));
vi.mock("@/lib/storage/service", () => ({
  listStorageNodes: async (...args: unknown[]) => (await getStorageOverviewMock(...args)).nodes,
}));

import { GET } from "../route";

describe("/api/storage/nodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValue({
      session: { userId: "user_1", username: "admin", roles: ["admin"] },
    });
    prismaMock.userStorageAccess.findMany.mockResolvedValue([]);
    getStorageOverviewMock.mockResolvedValue({
      nodes: [
        {
          id: "local_1",
          name: "本机图床源",
          driver: "LOCAL",
          basePath: "/srv/files",
          serverId: null,
          server: null,
        },
        {
          id: "sftp_1",
          name: "远端资料盘",
          driver: "SFTP",
          basePath: "/data",
          serverId: "srv_1",
          server: {
            id: "srv_1",
            name: "prod-vps",
            host: "203.0.113.10",
            port: 22,
          },
        },
        {
          id: "sftp_host",
          name: "独立 SFTP 主机",
          driver: "SFTP",
          basePath: "/archive",
          host: "sftp.example.com",
          serverId: null,
          server: null,
        },
      ],
    });
  });

  it("returns local storage nodes for image-bed publish selectors", async () => {
    const response = await GET(
      new Request("https://example.com/api/storage/nodes?driver=LOCAL"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      nodes: [
        {
          id: "local_1",
          name: "本机图床源",
          driver: "LOCAL",
          basePath: "/srv/files",
        },
      ],
    });
  });

  it("returns bound server metadata for SFTP nodes so direct gateway status works outside SSR pages", async () => {
    const response = await GET(
      new Request("https://example.com/api/storage/nodes?driver=SFTP"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      nodes: [
        {
          id: "sftp_1",
          name: "远端资料盘",
          driver: "SFTP",
          basePath: "/data",
          serverId: "srv_1",
          serverName: "prod-vps",
        },
        {
          id: "sftp_host",
          name: "独立 SFTP 主机",
          driver: "SFTP",
          basePath: "/archive",
          serverId: null,
          serverName: null,
        },
      ],
    });
  });

  it("hides nodes whose path grants deny reading and keeps nodes without grants", async () => {
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "user_1", username: "viewer", roles: ["viewer"] },
    });
    // sftp_1 is narrowed to a readable path, sftp_host to a write-only one;
    // local_1 has no grants and is not narrowed.
    prismaMock.userStorageAccess.findMany.mockResolvedValueOnce([
      { storageNodeId: "sftp_1", canRead: true },
      { storageNodeId: "sftp_host", canRead: false },
    ]);

    const response = await GET(
      new Request("https://example.com/api/storage/nodes"),
    );

    expect(response.status).toBe(200);
    expect(prismaMock.userStorageAccess.findMany).toHaveBeenCalledWith({
      where: { userId: "user_1" },
      select: { storageNodeId: true, canRead: true },
      take: 5000,
    });
    const { nodes } = await response.json() as { nodes: Array<{ id: string }> };
    expect(nodes.map((node) => node.id)).toEqual(["local_1", "sftp_1"]);
  });

  it("requires storage read permission", async () => {
    requireApiPermissionMock.mockResolvedValueOnce(
      NextResponse.json({ error: "缺少权限" }, { status: 403 }),
    );

    const response = await GET(
      new Request("https://example.com/api/storage/nodes"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "缺少权限" });
    expect(getStorageOverviewMock).not.toHaveBeenCalled();
  });
});

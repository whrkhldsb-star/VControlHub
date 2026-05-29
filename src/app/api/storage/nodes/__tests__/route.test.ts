import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireApiPermissionMock, getStorageOverviewMock } = vi.hoisted(() => ({
  requireApiPermissionMock: vi.fn(),
  getStorageOverviewMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));
vi.mock("@/lib/storage/service", () => ({
  getStorageOverview: getStorageOverviewMock,
}));

import { GET } from "../route";

describe("/api/storage/nodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValue({
      session: { userId: "user_1", username: "admin", roles: ["admin"] },
    });
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
      ],
    });
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

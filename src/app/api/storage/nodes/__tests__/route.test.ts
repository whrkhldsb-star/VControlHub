import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSessionMock, sessionHasPermissionMock, getStorageOverviewMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  getStorageOverviewMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({ requireSession: requireSessionMock }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: sessionHasPermissionMock }));
vi.mock("@/lib/storage/service", () => ({ getStorageOverview: getStorageOverviewMock }));

import { GET } from "../route";

describe("/api/storage/nodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue({ userId: "user_1", username: "admin", roles: ["admin"] });
    sessionHasPermissionMock.mockReturnValue(true);
    getStorageOverviewMock.mockResolvedValue({
      nodes: [
        { id: "local_1", name: "本机图床源", driver: "LOCAL", basePath: "/srv/files", serverId: null, server: null },
        {
          id: "sftp_1",
          name: "远端资料盘",
          driver: "SFTP",
          basePath: "/data",
          serverId: "srv_1",
          server: { id: "srv_1", name: "prod-vps", host: "203.0.113.10", port: 22 },
        },
      ],
    });
  });

  it("returns local storage nodes for image-bed publish selectors", async () => {
    const response = await GET(new Request("https://example.com/api/storage/nodes?driver=LOCAL"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      nodes: [
        { id: "local_1", name: "本机图床源", driver: "LOCAL", basePath: "/srv/files" },
      ],
    });
  });

  it("returns bound server metadata for SFTP nodes so direct gateway status works outside SSR pages", async () => {
    const response = await GET(new Request("https://example.com/api/storage/nodes?driver=SFTP"));

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
    sessionHasPermissionMock.mockReturnValueOnce(false);

    const response = await GET(new Request("https://example.com/api/storage/nodes"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "缺少权限" });
    expect(getStorageOverviewMock).not.toHaveBeenCalled();
  });
});

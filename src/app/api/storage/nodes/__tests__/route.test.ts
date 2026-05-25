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
        { id: "local_1", name: "本机图床源", driver: "LOCAL", basePath: "/srv/files" },
        { id: "sftp_1", name: "远端资料盘", driver: "SFTP", basePath: "/data" },
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

  it("requires storage read permission", async () => {
    sessionHasPermissionMock.mockReturnValueOnce(false);

    const response = await GET(new Request("https://example.com/api/storage/nodes"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "缺少权限" });
    expect(getStorageOverviewMock).not.toHaveBeenCalled();
  });
});

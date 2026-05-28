import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const { requireSessionMock, sessionHasPermissionMock, getStorageOverviewMock, getSftpSyncNodeMock, syncSftpDirectoryEntriesMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  getStorageOverviewMock: vi.fn(),
  getSftpSyncNodeMock: vi.fn(),
  syncSftpDirectoryEntriesMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({
  requireSession: requireSessionMock,
}));

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: sessionHasPermissionMock,
}));

vi.mock("@/lib/storage/service", () => ({
  getStorageOverview: getStorageOverviewMock,
}));

vi.mock("@/lib/storage/sftp-sync", () => ({
  getSftpSyncNode: getSftpSyncNodeMock,
  syncSftpDirectoryEntries: syncSftpDirectoryEntriesMock,
}));

import { GET } from "../route";

function overview() {
  return {
    nodes: [{ id: "node_sftp", name: "远端存储", driver: "SFTP" }],
    entries: [],
    remoteDirectories: [],
    stats: {
      totalNodes: 1,
      defaultNodeName: "远端存储",
      localNodeCount: 0,
      sftpNodeCount: 1,
      totalEntries: 0,
      previewableEntries: 0,
      deletedEntries: 0,
      remoteDirectoryCount: 0,
    },
  };
}

describe("/api/files/list", () => {
  it("keeps the current index visible when shallow SFTP sync fails", async () => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValueOnce({ userId: "u_1", username: "admin", roles: ["admin"] });
    sessionHasPermissionMock.mockImplementation((_session, permission) => permission !== "storage:delete");
    getStorageOverviewMock.mockResolvedValueOnce(overview());
    getSftpSyncNodeMock.mockResolvedValueOnce({ id: "node_sftp", driver: "SFTP" });
    syncSftpDirectoryEntriesMock.mockResolvedValueOnce({ created: 0, updated: 0, skipped: 0, errors: ["远端连接失败"] });

    const response = await GET(new NextRequest("https://app.example.test/api/files/list?nodeId=node_sftp"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      nodeIdFilter: "node_sftp",
      syncWarning: "远端连接失败",
      nodes: [{ id: "node_sftp", name: "远端存储", driver: "SFTP" }],
    });
    expect(getStorageOverviewMock).toHaveBeenCalledTimes(1);
  });
});

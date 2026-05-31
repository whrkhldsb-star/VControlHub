import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  withApiRouteMock,
  assertStorageAccessMock,
  getSftpSyncNodeMock,
  syncSftpDirectoryEntriesMock,
} = vi.hoisted(() => ({
  withApiRouteMock: vi.fn(),
  assertStorageAccessMock: vi.fn(),
  getSftpSyncNodeMock: vi.fn(),
  syncSftpDirectoryEntriesMock: vi.fn(),
}));

vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: withApiRouteMock,
}));

vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: assertStorageAccessMock,
}));

vi.mock("@/lib/storage/sftp-sync", () => ({
  getSftpSyncNode: getSftpSyncNodeMock,
  syncSftpDirectoryEntries: syncSftpDirectoryEntriesMock,
}));

import { POST } from "../route";

const session = { userId: "u_1", username: "admin", roles: ["admin"] };
const node = { id: "node_1", name: "remote", driver: "SFTP", basePath: "/data/files" };

function syncRequest(body: Record<string, unknown>) {
  return new Request("https://example.test/api/storage/sftp-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/storage/sftp-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withApiRouteMock.mockImplementation(async (_request, _options, handler) => handler({ session }));
    assertStorageAccessMock.mockResolvedValue({ allowed: true });
    getSftpSyncNodeMock.mockResolvedValue(node);
  });

  it("returns a failure status when no remote entries were synced because the real SFTP scan failed", async () => {
    syncSftpDirectoryEntriesMock.mockResolvedValueOnce({
      synced: 0,
      created: 0,
      updated: 0,
      deleted: 0,
      errors: ["扫描 /data/files 失败：扫描 /data/files 超过 60 秒，已停止本目录同步"],
    });

    const response = await POST(syncRequest({ nodeId: "node_1", remotePath: "/", recursive: true, maxDepth: 5 }));

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      synced: 0,
      errors: [expect.stringContaining("超过 60 秒")],
    });
    expect(assertStorageAccessMock).toHaveBeenCalledWith(expect.objectContaining({
      storageNodeId: "node_1",
      relativePath: "/",
      operation: "write",
    }));
    expect(syncSftpDirectoryEntriesMock).toHaveBeenCalledWith({
      node,
      remotePath: "/",
      recursive: true,
      maxDepth: 5,
    });
  });

  it("keeps partial SFTP sync warnings visible without claiming complete success", async () => {
    syncSftpDirectoryEntriesMock.mockResolvedValueOnce({
      synced: 2,
      created: 1,
      updated: 1,
      deleted: 0,
      errors: ["扫描 /data/files/logs 失败：连接超时"],
    });

    const response = await POST(syncRequest({ nodeId: "node_1", remotePath: "/", recursive: true, maxDepth: 5 }));

    expect(response.status).toBe(207);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      synced: 2,
      created: 1,
      updated: 1,
      errors: ["扫描 /data/files/logs 失败：连接超时"],
    });
  });
});

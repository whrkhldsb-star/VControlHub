import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  enqueueJobMock,
  withApiRouteMock,
  assertStorageAccessMock,
  getSftpSyncNodeMock,
  syncSftpDirectoryEntriesMock,
} = vi.hoisted(() => ({
  enqueueJobMock: vi.fn(),
  withApiRouteMock: vi.fn(),
  assertStorageAccessMock: vi.fn(),
  getSftpSyncNodeMock: vi.fn(),
  syncSftpDirectoryEntriesMock: vi.fn(),
}));

vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: withApiRouteMock,
}));

vi.mock("@/lib/job/service", () => ({
  enqueueJob: enqueueJobMock,
}));

vi.mock("@/lib/storage/sftp-sync-job", () => ({
  SFTP_SYNC_JOB_TYPE: "storage.sftp-sync",
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

function syncRequest(body: Record<string, unknown>, search = "") {
  return new Request(`https://example.test/api/storage/sftp-sync${search}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/storage/sftp-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withApiRouteMock.mockImplementation(async (request, options, handler) => {
      const body = options.bodySchema
        ? options.bodySchema.parse(await request.clone().json())
        : undefined;
      return handler({ session, body });
    });
    assertStorageAccessMock.mockResolvedValue({ allowed: true });
    getSftpSyncNodeMock.mockResolvedValue(node);
    enqueueJobMock.mockResolvedValue({ id: "job_1", status: "PENDING" });
  });

  it("queues SFTP sync as a durable background job by default", async () => {
    const response = await POST(syncRequest({ nodeId: "node_1", remotePath: "/", recursive: true, maxDepth: 5 }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      queued: true,
      jobId: "job_1",
      taskId: "job:job_1",
      message: expect.stringContaining("background task"),
    });
    expect(enqueueJobMock).toHaveBeenCalledWith({
      type: "storage.sftp-sync",
      title: "SFTP Sync: remote",
      payload: { nodeId: "node_1", remotePath: "/", recursive: true, maxDepth: 5 },
      createdBy: "u_1",
      maxAttempts: 3,
    });
    expect(syncSftpDirectoryEntriesMock).not.toHaveBeenCalled();
  });

  it("returns a failure status when no remote entries were synced because the real SFTP scan failed", async () => {
    syncSftpDirectoryEntriesMock.mockResolvedValueOnce({
      synced: 0,
      created: 0,
      updated: 0,
      deleted: 0,
      errors: ["扫描 /data/files 失败：扫描 /data/files 超过 60 秒，已停止本目录同步"],
    });

    const response = await POST(syncRequest({ nodeId: "node_1", remotePath: "/", recursive: true, maxDepth: 5 }, "?wait=1"));

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

    const response = await POST(syncRequest({ nodeId: "node_1", remotePath: "/", recursive: true, maxDepth: 5 }, "?wait=1"));

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

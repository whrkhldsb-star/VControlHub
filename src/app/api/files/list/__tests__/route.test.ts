import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const {
  requireApiPermissionMock,
  sessionHasPermissionMock,
  getStorageOverviewMock,
  getStorageAccessCapabilitiesMock,
  getSftpSyncNodeMock,
  syncSftpDirectoryEntriesMock,
} = vi.hoisted(() => ({
  requireApiPermissionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  getStorageOverviewMock: vi.fn(),
  getStorageAccessCapabilitiesMock: vi.fn(),
  getSftpSyncNodeMock: vi.fn(),
  syncSftpDirectoryEntriesMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: sessionHasPermissionMock,
}));

vi.mock("@/lib/storage/service", () => ({
  getStorageOverview: getStorageOverviewMock,
}));

vi.mock("@/lib/storage/access-control", () => ({
  getStorageAccessCapabilities: getStorageAccessCapabilitiesMock,
  getStorageAccessCapabilityKey: ({ storageNodeId, relativePath }: { storageNodeId: string; relativePath?: string | null }) =>
    `${storageNodeId}:${relativePath ?? ""}`,
}));

vi.mock("@/lib/storage/sftp-sync", () => ({
  getSftpSyncNode: getSftpSyncNodeMock,
  syncSftpDirectoryEntries: syncSftpDirectoryEntriesMock,
}));

import { GET } from "../route";

function overview() {
  return {
    nodes: [{ id: "node_sftp", name: "远端存储", driver: "SFTP" }],
    entries: [
      {
        id: "file_1",
        name: "remote.txt",
        entryType: "FILE",
        mimeType: "text/plain",
        relativePath: "remote.txt",
        size: BigInt(12),
        sizeLabel: "12 B",
        previewable: true,
        directAccess: { mode: "managed-download", description: "SFTP proxy" },
        storageNode: { id: "node_sftp", name: "远端存储", driver: "SFTP" },
        updatedAt: new Date("2026-05-30T00:00:00.000Z"),
      },
    ],
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
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "admin", roles: ["admin"] },
    });
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) => permission !== "storage:delete",
    );
    getStorageOverviewMock.mockResolvedValueOnce(overview());
    getSftpSyncNodeMock.mockResolvedValueOnce({
      id: "node_sftp",
      driver: "SFTP",
    });
    syncSftpDirectoryEntriesMock.mockResolvedValueOnce({
      created: 0,
      updated: 0,
      skipped: 0,
      errors: ["远端连接失败"],
    });
    getStorageAccessCapabilitiesMock.mockResolvedValueOnce(
      new Map([
        ["node_sftp:remote.txt", { canRead: true, canWrite: false, canDelete: true }],
      ]),
    );

    const response = await GET(
      new NextRequest(
        "https://app.example.test/api/files/list?nodeId=node_sftp",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      nodeIdFilter: "node_sftp",
      syncWarning: "远端连接失败",
      nodes: [{ id: "node_sftp", name: "远端存储", driver: "SFTP" }],
      files: [
        expect.objectContaining({
          id: "file_1",
          capabilities: { canRead: true, canWrite: false, canDelete: true },
        }),
      ],
    });
    expect(getStorageAccessCapabilitiesMock).toHaveBeenCalledWith({
      session: expect.objectContaining({ userId: "u_1" }),
      targets: [{ storageNodeId: "node_sftp", relativePath: "remote.txt" }],
    });
  });

  it("syncs selected SFTP nodes even for read-only file browsing", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_readonly", username: "viewer", roles: ["viewer"] },
    });
    sessionHasPermissionMock.mockReturnValue(false);
    getStorageOverviewMock
      .mockResolvedValueOnce(overview())
      .mockResolvedValueOnce({
        ...overview(),
        entries: [
          {
            ...overview().entries[0],
            id: "file_fresh",
            name: "fresh-remote.txt",
            relativePath: "fresh-remote.txt",
          },
        ],
      });
    getSftpSyncNodeMock.mockResolvedValueOnce({
      id: "node_sftp",
      driver: "SFTP",
    });
    syncSftpDirectoryEntriesMock.mockResolvedValueOnce({
      created: 1,
      updated: 0,
      skipped: 0,
      errors: [],
    });
    getStorageAccessCapabilitiesMock.mockResolvedValueOnce(new Map());

    const response = await GET(
      new NextRequest(
        "https://app.example.test/api/files/list?nodeId=node_sftp&path=logs",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(syncSftpDirectoryEntriesMock).toHaveBeenCalledWith({
      node: { id: "node_sftp", driver: "SFTP" },
      remotePath: "logs",
      recursive: false,
      maxDepth: 1,
    });
    expect(body.files).toEqual([
      expect.objectContaining({ id: "file_fresh", name: "fresh-remote.txt" }),
    ]);
    expect(body.permissions.canEditLocalFiles).toBe(false);
  });

  it("resolves grouped SFTP paths without nodeId before syncing and listing", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "admin", roles: ["admin"] },
    });
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) => permission !== "storage:delete",
    );
    const base = overview();
    const nodes = [
      { id: "node_sftp_abcdef", name: "45.207.216.45 存储", driver: "SFTP" },
    ];
    getStorageOverviewMock
      .mockResolvedValueOnce({ ...base, nodes, entries: [], remoteDirectories: [] })
      .mockResolvedValueOnce({
        ...base,
        nodes,
        entries: [
          {
            ...base.entries[0],
            id: "dir_new",
            name: "new-folder",
            entryType: "DIRECTORY",
            mimeType: "inode/directory",
            relativePath: "new-folder",
            storageNode: {
              id: "node_sftp_abcdef",
              name: "45.207.216.45 存储",
              driver: "SFTP",
              serverId: "server_1",
              server: null,
            },
          },
        ],
        remoteDirectories: [],
      });
    getSftpSyncNodeMock.mockResolvedValueOnce({
      id: "node_sftp_abcdef",
      driver: "SFTP",
    });
    syncSftpDirectoryEntriesMock.mockResolvedValueOnce({
      created: 1,
      updated: 0,
      skipped: 0,
      errors: [],
    });
    getStorageAccessCapabilitiesMock.mockResolvedValueOnce(new Map());

    const response = await GET(
      new NextRequest(
        "https://app.example.test/api/files/list?path=45.207.216.45%20%E5%AD%98%E5%82%A8__node_sft",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getSftpSyncNodeMock).toHaveBeenCalledWith("node_sftp_abcdef");
    expect(syncSftpDirectoryEntriesMock).toHaveBeenCalledWith({
      node: { id: "node_sftp_abcdef", driver: "SFTP" },
      remotePath: "",
      recursive: false,
      maxDepth: 1,
    });
    expect(body).toMatchObject({
      currentPath: "",
      nodeIdFilter: "node_sftp_abcdef",
    });
    expect(body.folders).toEqual([
      expect.objectContaining({ name: "new-folder", displayName: "new-folder" }),
    ]);
  });

  it("returns virtual grouped node roots during SPA refresh with no node filter", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "admin", roles: ["admin"] },
    });
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) => permission !== "storage:delete",
    );
    const base = overview();
    getStorageOverviewMock.mockResolvedValueOnce({
      ...base,
      nodes: [
        { id: "node_local", name: "本地存储", driver: "LOCAL" },
        { id: "node_sftp", name: "远端存储", driver: "SFTP" },
      ],
      entries: [
        {
          ...base.entries[0],
          storageNode: {
            id: "node_sftp",
            name: "远端存储",
            driver: "SFTP",
            serverId: "server_1",
            server: null,
          },
          name: "demo.mp4",
          relativePath: "movies/2026/demo.mp4",
          mimeType: "application/octet-stream",
        },
      ],
      remoteDirectories: [],
    });
    getStorageAccessCapabilitiesMock.mockResolvedValueOnce(new Map());

    const response = await GET(
      new NextRequest("https://app.example.test/api/files/list"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.folders.map((folder: { displayName: string }) => folder.displayName)).toEqual([
      "本地存储 (LOCAL)",
      "远端存储 (SFTP)",
    ]);
    const remote = body.folders.find(
      (folder: { displayName: string }) => folder.displayName === "远端存储 (SFTP)",
    );
    expect(remote).toMatchObject({ fileCount: 1, folderCount: 1 });
  });
});

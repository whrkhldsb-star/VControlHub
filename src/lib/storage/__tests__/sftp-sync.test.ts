import { describe, expect, it, vi } from "vitest";

const { prismaMock, listRemoteDirectoryMock } = vi.hoisted(() => ({
  prismaMock: {
    fileEntry: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  listRemoteDirectoryMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/ssh/ssh-key-crypto", () => ({
  decryptServerPassword: (value: string) => {
    if (value === "BROKEN CIPHER") {
      throw new Error("Unsupported state or unable to authenticate data");
    }
    return `decrypted-password:${value}`;
  },
  decryptSshPrivateKey: (value: string) => `decrypted:${value}`,
}));

vi.mock("@/lib/ssh/client", () => ({
  listRemoteDirectory: listRemoteDirectoryMock,
}));

import { syncSftpDirectoryEntries } from "../sftp-sync";

describe("sftp sync service", () => {
  it("syncs entries from a VPS-bound SFTP storage node into file entries", async () => {
    vi.clearAllMocks();
    const node = {
      id: "node_1",
      name: "remote",
      driver: "SFTP",
      basePath: "/data/files",
      host: null,
      port: null,
      username: null,
      server: {
        id: "srv_1",
        host: "203.0.113.20",
        port: 2222,
        username: "deploy",
        connectionType: "PASSWORD",
        password: "ENCRYPTED PASSWORD",
        sshKey: null,
      },
    } as const;

    listRemoteDirectoryMock.mockResolvedValueOnce([
      { name: "logs", longname: "drwxr-xr-x logs", type: "directory", size: 4096, modifyTime: 1, accessTime: 1 },
      { name: "demo.mp4", longname: "-rw-r--r-- demo.mp4", type: "file", size: 1024, modifyTime: 1, accessTime: 1 },
    ]);
    prismaMock.fileEntry.findFirst.mockResolvedValue(null);
    prismaMock.fileEntry.findMany.mockResolvedValue([]);
    prismaMock.fileEntry.create.mockResolvedValue({});
    prismaMock.fileEntry.updateMany.mockResolvedValue({ count: 0 });

    const result = await syncSftpDirectoryEntries({ node, recursive: false, maxDepth: 1 });

    expect(result).toEqual({ synced: 2, created: 2, updated: 0, deleted: 0, errors: [] });
    expect(listRemoteDirectoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "203.0.113.20",
        port: 2222,
        username: "deploy",
        password: "decrypted-password:ENCRYPTED PASSWORD",
        privateKey: undefined,
        remotePath: "/data/files",
      }),
    );
    expect(prismaMock.fileEntry.create).toHaveBeenCalledWith({
      data: {
        storageNodeId: "node_1",
        name: "logs",
        entryType: "DIRECTORY",
        mimeType: "inode/directory",
        size: null,
        relativePath: "logs",
      },
    });
    expect(prismaMock.fileEntry.create).toHaveBeenCalledWith({
      data: {
        storageNodeId: "node_1",
        name: "demo.mp4",
        entryType: "FILE",
        mimeType: "video/mp4",
        size: BigInt(1024),
        relativePath: "demo.mp4",
      },
    });
  });

  it("returns a sync error instead of throwing when stored credentials cannot be decrypted", async () => {
    vi.clearAllMocks();
    const node = {
      id: "node_1",
      name: "remote",
      driver: "SFTP",
      basePath: "/data/files",
      host: null,
      port: null,
      username: null,
      server: {
        id: "srv_1",
        host: "203.0.113.20",
        port: 2222,
        username: "deploy",
        connectionType: "PASSWORD",
        password: "BROKEN CIPHER",
        sshKey: null,
      },
    } as const;

    const result = await syncSftpDirectoryEntries({ node });

    expect(result).toEqual({
      synced: 0,
      created: 0,
      updated: 0,
      deleted: 0,
      errors: ["Connection credentials unavailable: Unsupported state or unable to authenticate data"],
    });
    expect(listRemoteDirectoryMock).not.toHaveBeenCalled();
  });

  it("marks stale entries under the synced directory as deleted", async () => {
    vi.clearAllMocks();
    const node = {
      id: "node_1",
      name: "remote",
      driver: "SFTP",
      basePath: "/data/files",
      host: null,
      port: null,
      username: null,
      server: {
        id: "srv_1",
        host: "203.0.113.20",
        port: 22,
        username: "root",
        connectionType: "PASSWORD",
        password: "secret",
        sshKey: null,
      },
    } as const;
    listRemoteDirectoryMock.mockResolvedValueOnce([
      { name: "live.txt", longname: "-rw-r--r-- live.txt", type: "file", size: 11, modifyTime: 1, accessTime: 1 },
    ]);
    prismaMock.fileEntry.findFirst.mockResolvedValue(null);
    prismaMock.fileEntry.findMany.mockResolvedValue([
      { id: "stale_1", relativePath: "team-a/old.txt" },
      { id: "live_1", relativePath: "team-a/live.txt" },
      { id: "nested_1", relativePath: "team-a/sub/keep.txt" },
      { id: "outside_1", relativePath: "other/old.txt" },
    ]);
    prismaMock.fileEntry.create.mockResolvedValue({});
    prismaMock.fileEntry.updateMany.mockResolvedValue({ count: 1 });

    const result = await syncSftpDirectoryEntries({ node, remotePath: "team-a", recursive: false });

    expect(result).toEqual({ synced: 1, created: 1, updated: 0, deleted: 1, errors: [] });
    expect(prismaMock.fileEntry.findMany).toHaveBeenCalledWith({
      where: {
        storageNodeId: "node_1",
        isDeleted: false,
        relativePath: { startsWith: "team-a/" },
      },
      select: { id: true, relativePath: true },
      take: 10_000,
    });
    expect(prismaMock.fileEntry.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["stale_1"] } },
      data: { isDeleted: true },
    });
  });

  it("stops a slow remote directory scan with an actionable timeout error before indexing", async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    const node = {
      id: "node_1",
      name: "remote",
      driver: "SFTP",
      basePath: "/data/files",
      host: null,
      port: null,
      username: null,
      server: {
        id: "srv_1",
        host: "203.0.113.20",
        port: 22,
        username: "root",
        connectionType: "PASSWORD",
        password: "secret",
        sshKey: null,
      },
    } as const;
    listRemoteDirectoryMock.mockReturnValueOnce(new Promise(() => {}));

    const syncPromise = syncSftpDirectoryEntries({ node, directoryTimeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    const result = await syncPromise;
    vi.useRealTimers();

    expect(result.synced).toBe(0);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.errors).toEqual([
      "Scanning /data/files failed: Scanning /data/files exceeded 1 seconds; stopped syncing this directory",
    ]);
    expect(prismaMock.fileEntry.create).not.toHaveBeenCalled();
    expect(prismaMock.fileEntry.updateMany).not.toHaveBeenCalled();
  });

});

import { describe, expect, it, vi } from "vitest";

const { prismaMock, listRemoteDirectoryMock } = vi.hoisted(() => ({
  prismaMock: {
    fileEntry: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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
    prismaMock.fileEntry.create.mockResolvedValue({});

    const result = await syncSftpDirectoryEntries({ node, recursive: false, maxDepth: 1 });

    expect(result).toEqual({ synced: 2, created: 2, updated: 0, errors: [] });
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
      errors: ["连接凭据不可用：Unsupported state or unable to authenticate data"],
    });
    expect(listRemoteDirectoryMock).not.toHaveBeenCalled();
  });
});

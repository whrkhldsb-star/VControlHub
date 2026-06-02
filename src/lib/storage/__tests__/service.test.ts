import {
  mkdir,
  mkdtemp,
  rm,
  writeFile as writeFileToDisk,
} from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

const { mockPrisma, listRemoteDirectoryMock } = vi.hoisted(() => ({
  mockPrisma: {
    storageNode: {
      updateMany: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    fileEntry: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
  listRemoteDirectoryMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
  isDatabaseUnavailableError: vi.fn(() => false),
}));
vi.mock("@/lib/ssh/client", () => ({
  listRemoteDirectory: listRemoteDirectoryMock,
}));
vi.mock("@/lib/ssh/ssh-key-crypto", () => ({
  decryptServerPassword: (value: string) => `decrypted:${value}`,
  decryptSshPrivateKey: (value: string) => `decrypted:${value}`,
}));
import {
  createFileEntry,
  createStorageNode,
  getLocalEditableFileDraft,
  getStorageOverview,
  listFileEntries,
  restoreFileEntry,
  updateStorageNode,
} from "@/lib/storage/service";
import { prisma } from "@/lib/db";

describe("storage service", () => {
  it("creates a local default storage node", async () => {
    vi.clearAllMocks();
    vi.mocked(prisma.storageNode.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.storageNode.create).mockResolvedValueOnce({
      id: "node_1",
      name: "主控本机",
      driver: "LOCAL",
      isDefault: true,
      basePath: "/srv/whrkhldsb/storage",
      host: null,
      port: null,
      username: null,
      serverId: null,
      directAccessMode: "PROXY",
      publicBaseUrl: null,
      directAccessExpiresSeconds: 300,
      server: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const result = await createStorageNode({
      name: "主控本机",
      driver: "LOCAL",
      basePath: "/srv/whrkhldsb/storage",
      isDefault: true,
    });

    expect(prisma.storageNode.updateMany).toHaveBeenCalledWith({
      where: {},
      data: { isDefault: false },
    });
    expect(result.connectionSummary).toContain("本机存储");
    expect(result.directAccess.mode).toBe("managed-download");
  });

  it("creates an sftp node with managed-download strategy", async () => {
    vi.clearAllMocks();
    vi.mocked(prisma.storageNode.create).mockResolvedValueOnce({
      id: "node_2",
      name: "香港媒体库",
      driver: "SFTP",
      isDefault: false,
      basePath: "/data/media",
      host: "203.0.113.11",
      port: 22,
      username: "root",
      serverId: "srv_1",
      directAccessMode: "DIRECT",
      publicBaseUrl: "https://cdn.example.com/media",
      directAccessExpiresSeconds: 900,
      server: {
        id: "srv_1",
        name: "hk-media-1",
        host: "203.0.113.11",
        port: 22,
        username: "root",
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const result = await createStorageNode({
      name: "香港媒体库",
      driver: "SFTP",
      basePath: "/data/media",
      isDefault: false,
      host: "203.0.113.11",
      port: 22,
      username: "root",
      serverId: "srv_1",
    });

    expect(result.connectionSummary).toContain("SFTP 存储");
    expect(result.directAccess.mode).toBe("direct-url");
    expect(result.directAccess.description).toContain("存储服务器直连");
  });

  it("lists file entries with preview flags and direct access strategy", async () => {
    vi.clearAllMocks();
    vi.mocked(prisma.fileEntry.findMany).mockResolvedValueOnce([
      {
        id: "file_1",
        name: "demo.mp4",
        entryType: "FILE",
        mimeType: "video/mp4",
        size: BigInt(1024),
        checksumSha256: null,
        relativePath: "videos/demo.mp4",
        storageNodeId: "node_2",
        parentId: null,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        storageNode: {
          id: "node_2",
          name: "香港媒体库",
          driver: "SFTP",
          basePath: "/data/media",
          host: "203.0.113.11",
          port: 22,
          username: "root",
          directAccessMode: "DIRECT",
          publicBaseUrl: "https://cdn.example.com/media",
          directAccessExpiresSeconds: 900,
          server: {
            id: "srv_1",
            name: "hk-media-1",
            host: "203.0.113.11",
            port: 22,
          },
        },
      } as any,
    ]);

    const result = await listFileEntries();

    expect(result[0]?.previewable).toBe(true);
    expect(result[0]?.directAccess.mode).toBe("direct-url");
    expect(result[0]?.directAccess.href).toContain(
      "/api/storage/direct-access",
    );
    expect(result[0]?.sizeLabel).toBe("1.0 KB");
  });

  it("builds storage overview stats", async () => {
    vi.clearAllMocks();
    vi.mocked(prisma.storageNode.findMany).mockResolvedValueOnce([
      {
        id: "node_1",
        name: "主控本机",
        driver: "LOCAL",
        isDefault: true,
        basePath: "/srv/whrkhldsb/storage",
        host: null,
        port: null,
        username: null,
        serverId: null,
        directAccessMode: "PROXY",
        publicBaseUrl: null,
        directAccessExpiresSeconds: 300,
        server: null,
        fileEntries: [{ id: "f_1" }],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ]);
    vi.mocked(prisma.fileEntry.findMany)
      .mockResolvedValueOnce([
        {
          id: "dir_1",
          name: "archives",
          entryType: "DIRECTORY",
          mimeType: "inode/directory",
          size: null,
          checksumSha256: null,
          relativePath: "archives",
          storageNodeId: "node_1",
          parentId: null,
          isDeleted: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          storageNode: {
            id: "node_1",
            name: "主控本机",
            driver: "LOCAL",
            basePath: "/srv/whrkhldsb/storage",
            host: null,
            port: null,
            username: null,
            server: null,
          },
        } as any,
        {
          id: "file_1",
          name: "cover.jpg",
          entryType: "FILE",
          mimeType: "image/jpeg",
          size: BigInt(128),
          checksumSha256: null,
          relativePath: "archives/2026/cover.jpg",
          storageNodeId: "node_1",
          parentId: null,
          isDeleted: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          storageNode: {
            id: "node_1",
            name: "主控本机",
            driver: "LOCAL",
            basePath: "/srv/whrkhldsb/storage",
            host: null,
            port: null,
            username: null,
            server: null,
          },
        } as any,
      ])
      .mockResolvedValueOnce([]);

    const result = await getStorageOverview();

    expect(result.stats.totalNodes).toBe(1);
    expect(result.stats.defaultNodeName).toBe("主控本机");
    expect(result.stats.previewableEntries).toBe(1);
    expect(
      result.remoteDirectories.map((directory: any) => directory.path),
    ).toEqual(["archives", "archives/2026"]);
    expect(result.stats.remoteDirectoryCount).toBe(2);
  });

  it("updates nullable SFTP connection fields when they are cleared in the edit form", async () => {
    vi.clearAllMocks();
    vi.mocked(prisma.storageNode.findUnique).mockResolvedValueOnce({
      id: "node_2",
      name: "远端存储",
      driver: "SFTP",
      isDefault: false,
      basePath: "/data/media",
      host: "203.0.113.10",
      port: 22,
      username: "root",
      serverId: "srv_1",
      directAccessMode: "DIRECT",
      publicBaseUrl: "https://cdn.example.com/media",
      directAccessExpiresSeconds: 600,
      server: {
        id: "srv_1",
        name: "old",
        host: "203.0.113.10",
        port: 22,
        username: "root",
      },
    } as any);
    vi.mocked(prisma.storageNode.update).mockResolvedValueOnce({
      id: "node_2",
    } as any);

    await updateStorageNode({
      storageNodeId: "node_2",
      driver: "LOCAL",
      serverId: null,
      host: null,
      username: null,
      directAccessMode: "PROXY",
      publicBaseUrl: "",
    });

    expect(prisma.storageNode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "node_2" },
        data: expect.objectContaining({
          driver: "LOCAL",
          serverId: null,
          host: null,
          username: null,
          directAccessMode: "PROXY",
          publicBaseUrl: null,
        }),
      }),
    );
  });

  it("normalizes safe public direct-access URLs before storage-node persistence", async () => {
    vi.clearAllMocks();
    vi.mocked(prisma.storageNode.create).mockResolvedValueOnce({
      id: "node_ipv6",
      name: "IPv6 直连库",
      driver: "SFTP",
      isDefault: false,
      basePath: "/data/media",
      host: "2001:4860:4860::8888",
      port: 22,
      username: "root",
      serverId: "srv_ipv6",
      directAccessMode: "DIRECT",
      publicBaseUrl: "http://[2001:4860:4860::8888]:31888/files",
      directAccessExpiresSeconds: 900,
      server: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    await createStorageNode({
      name: "IPv6 直连库",
      driver: "SFTP",
      basePath: "/data/media",
      host: "2001:4860:4860::8888",
      serverId: "srv_ipv6",
      directAccessMode: "DIRECT",
      publicBaseUrl: " http://[2001:4860:4860::8888]:31888/files/ ",
      directAccessExpiresSeconds: 900,
    });

    expect(prisma.storageNode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          publicBaseUrl: "http://[2001:4860:4860::8888]:31888/files",
        }),
      }),
    );
  });

  it("creates file metadata entries", async () => {
    vi.clearAllMocks();
    vi.mocked(prisma.fileEntry.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.fileEntry.create).mockResolvedValueOnce({
      id: "file_2",
      name: "notes.txt",
      entryType: "FILE",
      mimeType: "text/plain",
      size: BigInt(12),
      checksumSha256: null,
      relativePath: "docs/notes.txt",
      storageNodeId: "node_1",
      parentId: null,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const result = await createFileEntry({
      storageNodeId: "node_1",
      name: "notes.txt",
      entryType: "FILE",
      mimeType: "text/plain",
      size: 12,
      relativePath: "docs/notes.txt",
    });

    expect(result.name).toBe("notes.txt");
    expect(prisma.fileEntry.create).toHaveBeenCalled();
  });

  it("revives a soft-deleted file metadata entry instead of creating a duplicate path", async () => {
    vi.clearAllMocks();
    vi.mocked(prisma.fileEntry.findFirst).mockResolvedValueOnce({
      id: "deleted-folder",
      isDeleted: true,
    } as any);
    vi.mocked(prisma.fileEntry.update).mockResolvedValueOnce({
      id: "deleted-folder",
      name: "docs",
      entryType: "DIRECTORY",
      relativePath: "docs",
      isDeleted: false,
    } as any);

    await createFileEntry({
      storageNodeId: "node_1",
      name: "docs",
      entryType: "DIRECTORY",
      mimeType: "inode/directory",
      relativePath: "docs",
    });

    expect(prisma.fileEntry.create).not.toHaveBeenCalled();
    expect(prisma.fileEntry.update).toHaveBeenCalledWith({
      where: { id: "deleted-folder" },
      data: expect.objectContaining({
        name: "docs",
        entryType: "DIRECTORY",
        relativePath: "docs",
        isDeleted: false,
      }),
    });
  });

  it("rejects duplicate active file metadata entries", async () => {
    vi.clearAllMocks();
    vi.mocked(prisma.fileEntry.findFirst).mockResolvedValueOnce({
      id: "active-folder",
      isDeleted: false,
    } as any);

    await expect(
      createFileEntry({
        storageNodeId: "node_1",
        name: "docs",
        entryType: "DIRECTORY",
        mimeType: "inode/directory",
        relativePath: "docs",
      }),
    ).rejects.toThrow("路径已存在: docs");
    expect(prisma.fileEntry.create).not.toHaveBeenCalled();
    expect(prisma.fileEntry.update).not.toHaveBeenCalled();
  });

  it("loads editable local file drafts from local storage", async () => {
    vi.clearAllMocks();
    const tempRoot = await mkdtemp(path.join(tmpdir(), "storage-editable-"));
    const relativePath = "docs/notes.txt";
    const absolutePath = path.join(tempRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFileToDisk(absolutePath, "hello world", "utf8");

    vi.mocked(prisma.fileEntry.findUnique).mockResolvedValueOnce({
      id: "file_3",
      name: "notes.txt",
      entryType: "FILE",
      mimeType: "text/plain",
      size: BigInt(12),
      checksumSha256: null,
      relativePath,
      storageNodeId: "node_1",
      parentId: null,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date("2026-04-20T01:02:03.000Z"),
      storageNode: {
        id: "node_1",
        name: "主控本机",
        driver: "LOCAL",
        basePath: tempRoot,
      },
    } as any);

    try {
      const result = await getLocalEditableFileDraft("file_3");

      expect(result).toMatchObject({
        fileEntryId: "file_3",
        name: "notes.txt",
        relativePath,
        content: "hello world",
        byteSize: 11,
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("clears host port and username when editing an SFTP node back to VPS-bound credentials", async () => {
    vi.clearAllMocks();
    vi.mocked(prisma.storageNode.findUnique).mockResolvedValueOnce({
      id: "node_1",
      name: "旧远端",
      driver: "SFTP",
      basePath: "/old",
      isDefault: false,
      host: "198.51.100.9",
      port: 2222,
      username: "old-user",
      serverId: null,
      directAccessMode: "PROXY",
      publicBaseUrl: null,
      directAccessExpiresSeconds: 300,
      server: null,
    } as any);
    vi.mocked(prisma.storageNode.update).mockResolvedValueOnce({} as any);

    await updateStorageNode({
      storageNodeId: "node_1",
      name: "绑定 VPS",
      driver: "SFTP",
      basePath: "/data/files",
      host: null,
      port: null,
      username: null,
      serverId: "srv_1",
    });

    expect(prisma.storageNode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          host: null,
          port: null,
          username: null,
          serverId: "srv_1",
        }),
      }),
    );
  });

  it("restores a local deleted entry only when the real file still exists", async () => {
    vi.clearAllMocks();
    const tempRoot = await mkdtemp(path.join(tmpdir(), "storage-restore-"));
    const relativePath = "docs/notes.txt";
    const absolutePath = path.join(tempRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFileToDisk(absolutePath, "recover me", "utf8");

    vi.mocked(prisma.fileEntry.findUnique).mockResolvedValueOnce({
      id: "file_restore_local",
      name: "notes.txt",
      entryType: "FILE",
      mimeType: "text/plain",
      size: BigInt(10),
      checksumSha256: null,
      relativePath,
      storageNodeId: "node_1",
      parentId: null,
      isDeleted: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      storageNode: {
        id: "node_1",
        driver: "LOCAL",
        basePath: tempRoot,
        host: null,
        port: null,
        username: null,
        server: null,
      },
    } as any);
    vi.mocked(prisma.fileEntry.update).mockResolvedValueOnce({
      id: "file_restore_local",
      isDeleted: false,
    } as any);

    try {
      await restoreFileEntry({ fileEntryId: "file_restore_local" });
      expect(prisma.fileEntry.update).toHaveBeenCalledWith({
        where: { id: "file_restore_local" },
        data: { isDeleted: false },
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not restore a local deleted entry when the real file is missing", async () => {
    vi.clearAllMocks();
    const tempRoot = await mkdtemp(
      path.join(tmpdir(), "storage-restore-missing-"),
    );

    vi.mocked(prisma.fileEntry.findUnique).mockResolvedValueOnce({
      id: "file_missing_local",
      name: "missing.txt",
      entryType: "FILE",
      mimeType: "text/plain",
      size: BigInt(10),
      checksumSha256: null,
      relativePath: "docs/missing.txt",
      storageNodeId: "node_1",
      parentId: null,
      isDeleted: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      storageNode: {
        id: "node_1",
        driver: "LOCAL",
        basePath: tempRoot,
        host: null,
        port: null,
        username: null,
        server: null,
      },
    } as any);

    try {
      await expect(
        restoreFileEntry({ fileEntryId: "file_missing_local" }),
      ).rejects.toThrow("原始文件已不存在");
      expect(prisma.fileEntry.update).not.toHaveBeenCalled();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("restores an SFTP deleted entry only after confirming the remote file still exists", async () => {
    vi.clearAllMocks();
    vi.mocked(prisma.fileEntry.findUnique).mockResolvedValueOnce({
      id: "file_restore_sftp",
      name: "report.pdf",
      entryType: "FILE",
      mimeType: "application/pdf",
      size: BigInt(123),
      checksumSha256: null,
      relativePath: "team/report.pdf",
      storageNodeId: "node_2",
      parentId: null,
      isDeleted: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      storageNode: {
        id: "node_2",
        driver: "SFTP",
        basePath: "/data/files",
        host: "203.0.113.10",
        port: 2222,
        username: "deploy",
        server: {
          host: "203.0.113.10",
          port: 22,
          username: "root",
          connectionType: "PASSWORD",
          password: "cipher",
          sshKey: null,
        },
      },
    } as any);
    listRemoteDirectoryMock.mockResolvedValueOnce([
      {
        name: "report.pdf",
        longname: "",
        type: "file",
        size: 123,
        modifyTime: 0,
        accessTime: 0,
      },
    ]);
    vi.mocked(prisma.fileEntry.update).mockResolvedValueOnce({
      id: "file_restore_sftp",
      isDeleted: false,
    } as any);

    await restoreFileEntry({ fileEntryId: "file_restore_sftp" });

    expect(listRemoteDirectoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "203.0.113.10",
        port: 2222,
        username: "deploy",
        remotePath: "/data/files/team",
        password: "decrypted:cipher",
      }),
    );
    expect(prisma.fileEntry.update).toHaveBeenCalledWith({
      where: { id: "file_restore_sftp" },
      data: { isDeleted: false },
    });
  });

  it("does not restore an SFTP deleted entry when the remote file is missing", async () => {
    vi.clearAllMocks();
    vi.mocked(prisma.fileEntry.findUnique).mockResolvedValueOnce({
      id: "file_missing_sftp",
      name: "missing.pdf",
      entryType: "FILE",
      mimeType: "application/pdf",
      size: BigInt(123),
      checksumSha256: null,
      relativePath: "team/missing.pdf",
      storageNodeId: "node_2",
      parentId: null,
      isDeleted: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      storageNode: {
        id: "node_2",
        driver: "SFTP",
        basePath: "/data/files",
        host: "203.0.113.10",
        port: 22,
        username: "root",
        server: {
          host: "203.0.113.10",
          port: 22,
          username: "root",
          connectionType: "SSH_KEY",
          password: null,
          sshKey: { privateKey: "cipher-key" },
        },
      },
    } as any);
    listRemoteDirectoryMock.mockResolvedValueOnce([]);

    await expect(
      restoreFileEntry({ fileEntryId: "file_missing_sftp" }),
    ).rejects.toThrow("原始远端文件已不存在");
    expect(prisma.fileEntry.update).not.toHaveBeenCalled();
  });
});

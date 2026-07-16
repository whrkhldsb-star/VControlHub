import { describe, expect, it, vi } from "vitest";

const {
  requireApiSessionMock,
  sessionHasPermissionMock,
  assertStorageAccessMock,
  prismaMock,
  deleteRemoteFileMock,
  createRemoteDirectoryMock,
  renameRemoteFileMock,
  readRemoteFileMock,
  writeRemoteFileMock,
} = vi.hoisted(() => ({
  requireApiSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(() => true),
  assertStorageAccessMock: vi.fn<
    () => Promise<{ allowed: boolean; reason?: string }>
  >(() => Promise.resolve({ allowed: true })),
  prismaMock: {
    storageNode: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    fileEntry: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
  deleteRemoteFileMock: vi.fn(),
  createRemoteDirectoryMock: vi.fn(),
  renameRemoteFileMock: vi.fn(),
  readRemoteFileMock: vi.fn(),
  writeRemoteFileMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: requireApiSessionMock,
}));

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: sessionHasPermissionMock,
}));

vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: assertStorageAccessMock,
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/ssh/ssh-key-crypto", () => ({
  decryptServerPassword: (value: string) => `decrypted-password:${value}`,
  decryptSshPrivateKey: (value: string) => `decrypted:${value}`,
}));

vi.mock("@/lib/ssh/client", () => ({
  createRemoteDirectory: createRemoteDirectoryMock,
  deleteRemoteFile: deleteRemoteFileMock,
  renameRemoteFile: renameRemoteFileMock,
  readRemoteFile: readRemoteFileMock,
  writeRemoteFile: writeRemoteFileMock,
}));

import { POST } from "../route";

function request(body: unknown) {
  return new Request("https://example.com/api/storage/sftp-ops", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function mockSftpNode() {
  const node = {
    id: "node_1",
    name: "remote",
    driver: "SFTP",
    basePath: "/data/files",
    host: null,
    port: null,
    username: null,
    serverId: "srv_1",
    server: {
      id: "srv_1",
      host: "203.0.113.10",
      port: 22,
      username: "root",
      connectionType: "SSH_KEY",
      password: null,
      sshKey: { privateKey: "PRIVATE KEY" },
    },
  };
  prismaMock.storageNode.findFirst.mockResolvedValueOnce(node);
  prismaMock.storageNode.findUnique.mockResolvedValueOnce(node);
}

describe("/api/storage/sftp-ops", () => {
  it("allows writing a new file under a nested directory so users can create files from the file manager", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce({
      userId: "u_1",
      username: "alice",
      roles: ["admin"],
      currentTeamId: null,
    });
    mockSftpNode();

    const response = await POST(
      request({
        action: "write",
        nodeId: "node_1",
        path: "new-folder/hello.txt",
        content: "hello",
      }),
    );

    expect(response.status).toBe(200);
    expect(assertStorageAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        storageNodeId: "node_1",
        relativePath: "new-folder/hello.txt",
        operation: "write",
        writeBytes: 5,
      }),
    );
    expect(writeRemoteFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        remotePath: "/data/files/new-folder/hello.txt",
        content: Buffer.from("hello", "utf8"),
      }),
    );
    expect(createRemoteDirectoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        remotePath: "/data/files/new-folder",
        recursive: true,
      }),
    );
    expect(prismaMock.fileEntry.upsert).toHaveBeenCalledWith({
      where: {
        storageNodeId_relativePath: {
          storageNodeId: "node_1",
          relativePath: "new-folder/hello.txt",
        },
      },
      update: expect.objectContaining({
        name: "hello.txt",
        entryType: "FILE",
        size: BigInt(5),
        isDeleted: false,
      }),
      create: expect.objectContaining({
        storageNodeId: "node_1",
        name: "hello.txt",
        entryType: "FILE",
        relativePath: "new-folder/hello.txt",
        size: BigInt(5),
      }),
    });
  });

  it("removes a remotely written SFTP file when index persistence fails", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce({
      userId: "u_1",
      username: "alice",
      roles: ["admin"],
      currentTeamId: null,
    });
    mockSftpNode();
    prismaMock.fileEntry.upsert.mockRejectedValueOnce(new Error("db unavailable"));

    const response = await POST(
      request({
        action: "write",
        nodeId: "node_1",
        path: "new-folder/hello.txt",
        content: "hello",
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("Remote file operation failed"),
    });
    expect(writeRemoteFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ remotePath: "/data/files/new-folder/hello.txt" }),
    );
    expect(deleteRemoteFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ remotePath: "/data/files/new-folder/hello.txt" }),
    );
  });

  it("checks storage access for both source and destination before rename", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce({
      userId: "u_1",
      username: "alice",
      roles: ["admin"],
      currentTeamId: null,
    });
    mockSftpNode();

    const response = await POST(
      request({
        action: "rename",
        nodeId: "node_1",
        path: "allowed/a.txt",
        newPath: "allowed/b.txt",
      }),
    );

    expect(response.status).toBe(200);
    expect(assertStorageAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        storageNodeId: "node_1",
        relativePath: "allowed/a.txt",
        operation: "write",
      }),
    );
    expect(assertStorageAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        storageNodeId: "node_1",
        relativePath: "allowed/b.txt",
        operation: "write",
      }),
    );
    expect(createRemoteDirectoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        remotePath: "/data/files/allowed",
        recursive: true,
      }),
    );
    expect(renameRemoteFileMock).toHaveBeenCalled();
    expect(prismaMock.fileEntry.updateMany).toHaveBeenCalledWith({
      where: { storageNodeId: "node_1", relativePath: "allowed/a.txt" },
      data: { relativePath: "allowed/b.txt", name: "b.txt", isDeleted: false },
    });
  });

  it("creates the destination directory before renaming a SFTP file into a nested new path", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce({
      userId: "u_1",
      username: "alice",
      roles: ["admin"],
      currentTeamId: null,
    });
    mockSftpNode();

    const response = await POST(
      request({
        action: "rename",
        nodeId: "node_1",
        path: "allowed/a.txt",
        newPath: "nested/path/b.txt",
      }),
    );

    expect(response.status).toBe(200);
    expect(createRemoteDirectoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        remotePath: "/data/files/nested/path",
        recursive: true,
      }),
    );
    expect(renameRemoteFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        oldPath: "/data/files/allowed/a.txt",
        newPath: "/data/files/nested/path/b.txt",
      }),
    );
    expect(prismaMock.fileEntry.updateMany).toHaveBeenCalledWith({
      where: { storageNodeId: "node_1", relativePath: "allowed/a.txt" },
      data: { relativePath: "nested/path/b.txt", name: "b.txt", isDeleted: false },
    });
  });

  it("rejects indexed oversized SFTP reads before downloading the remote file into memory", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce({
      userId: "u_1",
      username: "alice",
      roles: ["admin"],
      currentTeamId: null,
    });
    mockSftpNode();
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce({
      size: BigInt(1024 * 1024 + 1),
    });

    const response = await POST(
      request({
        action: "read",
        nodeId: "node_1",
        path: "large.log",
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("File exceeds 1 MB"),
      maxInlineBytes: 1024 * 1024,
    });
    expect(readRemoteFileMock).not.toHaveBeenCalled();
  });

  it("reads SFTP content through fs-backend (readRemoteFile) for text files", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce({
      userId: "u_1",
      username: "alice",
      roles: ["admin"],
      currentTeamId: null,
    });
    mockSftpNode();
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce({
      size: BigInt(5),
    });
    readRemoteFileMock.mockResolvedValueOnce(Buffer.from("hello"));

    const response = await POST(
      request({
        action: "read",
        nodeId: "node_1",
        path: "notes.txt",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      content: "hello",
      encoding: "text",
      size: 5,
    });
    expect(readRemoteFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        remotePath: "/data/files/notes.txt",
      }),
    );
  });

  it("rejects oversized SFTP reads after download when the index has no size", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce({
      userId: "u_1",
      username: "alice",
      roles: ["admin"],
      currentTeamId: null,
    });
    mockSftpNode();
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(null);
    readRemoteFileMock.mockResolvedValueOnce(Buffer.alloc(1024 * 1024 + 1));

    const response = await POST(
      request({
        action: "read",
        nodeId: "node_1",
        path: "large.log",
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("File exceeds 1 MB"),
      size: 1024 * 1024 + 1,
    });
  });

  it("soft-deletes the file index only after remote delete succeeds", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce({
      userId: "u_1",
      username: "alice",
      roles: ["admin"],
      currentTeamId: null,
    });
    mockSftpNode();

    const response = await POST(
      request({
        action: "delete",
        nodeId: "node_1",
        path: "old/file.txt",
      }),
    );

    expect(response.status).toBe(200);
    expect(deleteRemoteFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ remotePath: "/data/files/old/file.txt" }),
    );
    expect(prismaMock.fileEntry.updateMany).toHaveBeenCalledWith({
      where: { storageNodeId: "node_1", relativePath: "old/file.txt" },
      data: { isDeleted: true },
    });
  });

  it("soft-deletes a SFTP directory and its indexed descendants after remote delete succeeds", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce({
      userId: "u_1",
      username: "alice",
      roles: ["admin"],
      currentTeamId: null,
    });
    mockSftpNode();

    const response = await POST(
      request({
        action: "delete",
        nodeId: "node_1",
        path: "old-folder",
        isDirectory: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(deleteRemoteFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        remotePath: "/data/files/old-folder",
        isDirectory: true,
      }),
    );
    expect(prismaMock.fileEntry.updateMany).toHaveBeenCalledWith({
      where: {
        storageNodeId: "node_1",
        OR: [
          { relativePath: "old-folder" },
          { relativePath: { startsWith: "old-folder/" } },
        ],
      },
      data: { isDeleted: true },
    });
  });

  it("renames a SFTP directory and rewrites indexed descendant paths", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce({
      userId: "u_1",
      username: "alice",
      roles: ["admin"],
      currentTeamId: null,
    });
    mockSftpNode();
    prismaMock.fileEntry.findMany.mockResolvedValueOnce([
      { id: "child-1", relativePath: "allowed/a.txt" },
      { id: "child-2", relativePath: "allowed/nested/b.txt" },
    ]);

    const response = await POST(
      request({
        action: "rename",
        nodeId: "node_1",
        path: "allowed",
        newPath: "renamed",
        isDirectory: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(renameRemoteFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        oldPath: "/data/files/allowed",
        newPath: "/data/files/renamed",
      }),
    );
    expect(prismaMock.fileEntry.findMany).toHaveBeenCalledWith({
      where: {
        storageNodeId: "node_1",
        relativePath: { startsWith: "allowed/" },
      },
      select: { id: true, relativePath: true },
      take: 10_000,
    });
    expect(prismaMock.fileEntry.update).toHaveBeenCalledWith({
      where: { id: "child-1" },
      data: { relativePath: "renamed/a.txt", isDeleted: false },
    });
    expect(prismaMock.fileEntry.update).toHaveBeenCalledWith({
      where: { id: "child-2" },
      data: { relativePath: "renamed/nested/b.txt", isDeleted: false },
    });
    expect(prismaMock.fileEntry.updateMany).toHaveBeenCalledWith({
      where: { storageNodeId: "node_1", relativePath: "allowed" },
      data: { relativePath: "renamed", name: "renamed", isDeleted: false },
    });
  });

  it("rejects rename when destination path is outside the user's storage grant", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce({
      userId: "u_1",
      username: "alice",
      roles: ["admin"],
      currentTeamId: null,
    });
    mockSftpNode();
    assertStorageAccessMock
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false, reason: "目标路径无授权" } as {
        allowed: boolean;
        reason?: string;
      });

    const response = await POST(
      request({
        action: "rename",
        nodeId: "node_1",
        path: "allowed/a.txt",
        newPath: "private/b.txt",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "目标路径无授权",
    });
    expect(renameRemoteFileMock).not.toHaveBeenCalled();
  });
});

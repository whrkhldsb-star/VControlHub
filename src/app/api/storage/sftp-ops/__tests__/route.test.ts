import { describe, expect, it, vi } from "vitest";

const {
  requireSessionMock,
  sessionHasPermissionMock,
  assertStorageAccessMock,
  prismaMock,
  createRemoteDirectoryMock,
  renameRemoteFileMock,
  writeRemoteFileMock,
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(() => true),
  assertStorageAccessMock: vi.fn<() => Promise<{ allowed: boolean; reason?: string }>>(() => Promise.resolve({ allowed: true })),
  prismaMock: {
    storageNode: {
      findUnique: vi.fn(),
    },
  },
  createRemoteDirectoryMock: vi.fn(),
  renameRemoteFileMock: vi.fn(),
  writeRemoteFileMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({
  requireSession: requireSessionMock,
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

vi.mock("@/lib/ssh/client", () => ({
  createRemoteDirectory: createRemoteDirectoryMock,
  deleteRemoteFile: vi.fn(),
  renameRemoteFile: renameRemoteFileMock,
  readRemoteFile: vi.fn(),
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
  prismaMock.storageNode.findUnique.mockResolvedValueOnce({
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
  });
}

describe("/api/storage/sftp-ops", () => {
  it("allows writing a new file under a nested directory so users can create files from the file manager", async () => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValueOnce({ userId: "u_1", username: "alice" });
    mockSftpNode();

    const response = await POST(
      request({ action: "write", nodeId: "node_1", path: "new-folder/hello.txt", content: "hello" }),
    );

    expect(response.status).toBe(200);
    expect(assertStorageAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ storageNodeId: "node_1", relativePath: "new-folder/hello.txt", operation: "write", writeBytes: 5 }),
    );
    expect(writeRemoteFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ remotePath: "/data/files/new-folder/hello.txt", content: "hello" }),
    );
    expect(createRemoteDirectoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ remotePath: "/data/files/new-folder" }),
    );
  });

  it("checks storage access for both source and destination before rename", async () => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValueOnce({ userId: "u_1", username: "alice" });
    mockSftpNode();

    const response = await POST(
      request({ action: "rename", nodeId: "node_1", path: "allowed/a.txt", newPath: "allowed/b.txt" }),
    );

    expect(response.status).toBe(200);
    expect(assertStorageAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ storageNodeId: "node_1", relativePath: "allowed/a.txt", operation: "write" }),
    );
    expect(assertStorageAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ storageNodeId: "node_1", relativePath: "allowed/b.txt", operation: "write" }),
    );
    expect(renameRemoteFileMock).toHaveBeenCalled();
  });

  it("rejects rename when destination path is outside the user's storage grant", async () => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValueOnce({ userId: "u_1", username: "alice" });
    mockSftpNode();
    assertStorageAccessMock
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false, reason: "目标路径无授权" } as { allowed: boolean; reason?: string });

    const response = await POST(
      request({ action: "rename", nodeId: "node_1", path: "allowed/a.txt", newPath: "private/b.txt" }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "目标路径无授权" });
    expect(renameRemoteFileMock).not.toHaveBeenCalled();
  });
});

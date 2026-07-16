import { describe, expect, it, vi } from "vitest";

const {
  requireApiPermissionMock,
  assertStorageAccessMock,
  prismaMock,
  listRemoteDirectoryMock,
} = vi.hoisted(() => ({
  requireApiPermissionMock: vi.fn(),
  assertStorageAccessMock: vi.fn<
    () => Promise<{ allowed: boolean; reason?: string }>
  >(() => Promise.resolve({ allowed: true })),
  prismaMock: {
    storageNode: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
  listRemoteDirectoryMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
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
  listRemoteDirectory: listRemoteDirectoryMock,
}));

import { GET } from "../route";

function request(path = "/") {
  const params = new URLSearchParams({ nodeId: "node_1", path });
  return new Request(
    `https://example.com/api/storage/sftp?${params.toString()}`,
  );
}

function mockSftpNode(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
  prismaMock.storageNode.findFirst.mockResolvedValueOnce(node);
  prismaMock.storageNode.findUnique.mockResolvedValueOnce(node);
}

describe("/api/storage/sftp", () => {
  it("lists a remote directory through the canonical storage API", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "alice", roles: ["admin"], currentTeamId: null },
    });
    mockSftpNode();
    listRemoteDirectoryMock.mockResolvedValueOnce([
      {
        name: "logs",
        longname: "drwxr-xr-x logs",
        type: "directory",
        size: 4096,
        modifyTime: 1,
        accessTime: 1,
      },
    ]);

    const response = await GET(request("/"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      nodeId: "node_1",
      nodeName: "remote",
      remotePath: "/",
      entries: [{ name: "logs", type: "directory" }],
    });
    expect(listRemoteDirectoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "203.0.113.10",
        port: 22,
        username: "root",
        privateKey: "decrypted:PRIVATE KEY",
        remotePath: "/data/files",
      }),
    );
  });

  it("returns the browser-facing relative path while using the normalized absolute path for SSH", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "alice", roles: ["admin"], currentTeamId: null },
    });
    mockSftpNode();
    listRemoteDirectoryMock.mockResolvedValueOnce([]);

    const response = await GET(request("/logs/../reports"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      remotePath: "/logs/../reports",
    });
    expect(listRemoteDirectoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ remotePath: "/data/files/reports" }),
    );
    expect(assertStorageAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        storageNodeId: "node_1",
        relativePath: "reports",
        operation: "read",
      }),
    );
  });

  it("decrypts password-based VPS credentials before listing a remote directory", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "alice", roles: ["admin"], currentTeamId: null },
    });
    mockSftpNode({
      server: {
        id: "srv_1",
        host: "203.0.113.20",
        port: 2222,
        username: "deploy",
        connectionType: "PASSWORD",
        password: "ENCRYPTED PASSWORD",
        sshKey: null,
      },
    });
    listRemoteDirectoryMock.mockResolvedValueOnce([]);

    const response = await GET(request("/"));

    expect(response.status).toBe(200);
    expect(listRemoteDirectoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "203.0.113.20",
        port: 2222,
        username: "deploy",
        password: "decrypted-password:ENCRYPTED PASSWORD",
        privateKey: undefined,
      }),
    );
  });
});

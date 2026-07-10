import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, accessMock, statMock, listRemoteDirectoryMock } = vi.hoisted(() => ({
  prismaMock: {
    storageNode: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  accessMock: vi.fn(),
  statMock: vi.fn(),
  listRemoteDirectoryMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
  isDatabaseUnavailableError: vi.fn(() => false),
}));

vi.mock("node:fs/promises", () => ({
  default: { access: accessMock, stat: statMock, readFile: vi.fn(), writeFile: vi.fn() },
  access: accessMock,
  stat: statMock,
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("@/lib/ssh/client", () => ({
  listRemoteDirectory: listRemoteDirectoryMock,
}));

vi.mock("@/lib/ssh/ssh-key-crypto", () => ({
  decryptServerPassword: vi.fn((value: string) => (value === "enc:v1:SECRET" ? "SECRET" : value)),
  decryptSshPrivateKey: vi.fn((value: string) => (value === "enc:v1:PRIVATE KEY" ? "PRIVATE KEY" : value)),
}));

import { checkStorageNodeHealth } from "../service";

describe("checkStorageNodeHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.storageNode.update.mockImplementation(async ({ data }) => ({ id: "node-1", ...data }));
  });

  it("marks a LOCAL node healthy when its base path is an accessible directory", async () => {
    prismaMock.storageNode.findUnique.mockResolvedValueOnce({
      id: "node-1",
      driver: "LOCAL",
      basePath: "/srv/storage",
      host: null,
      port: null,
      username: null,
      server: null,
    });
    statMock.mockResolvedValueOnce({ isDirectory: () => true });
    accessMock.mockResolvedValueOnce(undefined);

    const result = await checkStorageNodeHealth("node-1");

    expect(result.healthStatus).toBe("HEALTHY");
    expect(result.lastHealthError).toBeNull();
    expect(accessMock).toHaveBeenCalledWith("/srv/storage", expect.any(Number));
    expect(prismaMock.storageNode.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "node-1" },
      data: expect.objectContaining({ healthStatus: "HEALTHY", lastHealthError: null }),
    }));
  });

  it("marks a LOCAL node unhealthy when the base path is not a directory", async () => {
    prismaMock.storageNode.findUnique.mockResolvedValueOnce({
      id: "node-1",
      driver: "LOCAL",
      basePath: "/srv/storage-file",
      host: null,
      port: null,
      username: null,
      server: null,
    });
    statMock.mockResolvedValueOnce({ isDirectory: () => false });

    const result = await checkStorageNodeHealth("node-1");

    expect(result.healthStatus).toBe("UNHEALTHY");
    expect(result.lastHealthError).toMatch(/not a directory/);
    expect(accessMock).not.toHaveBeenCalled();
  });

  it("checks an SFTP node by listing its normalized remote base path", async () => {
    prismaMock.storageNode.findUnique.mockResolvedValueOnce({
      id: "node-1",
      driver: "SFTP",
      basePath: "/data/root/",
      host: "203.0.113.10",
      port: 2222,
      username: "deployer",
      server: { host: "server-host", port: 22, username: "root", password: null, sshKeyId: "key-1", sshKey: { privateKey: "PRIVATE KEY" } },
    });
    listRemoteDirectoryMock.mockResolvedValueOnce([]);

    const result = await checkStorageNodeHealth("node-1");

    expect(result.healthStatus).toBe("HEALTHY");
    expect(listRemoteDirectoryMock).toHaveBeenCalledWith(expect.objectContaining({
      host: "203.0.113.10",
      port: 2222,
      username: "deployer",
      privateKey: "PRIVATE KEY",
      remotePath: "/data/root",
    }));
  });

  it("decrypts encrypted SFTP server credentials before health checks", async () => {
    prismaMock.storageNode.findUnique.mockResolvedValueOnce({
      id: "node-1",
      driver: "SFTP",
      basePath: "/data/root",
      host: null,
      port: null,
      username: null,
      server: { host: "server-host", port: 22, username: "root", password: "enc:v1:SECRET", sshKeyId: null, sshKey: null },
    });
    listRemoteDirectoryMock.mockResolvedValueOnce([]);

    await checkStorageNodeHealth("node-1");

    expect(listRemoteDirectoryMock).toHaveBeenCalledWith(expect.objectContaining({
      host: "server-host",
      port: 22,
      username: "root",
      password: "SECRET",
    }));
  });

  it("marks an SFTP node unhealthy without leaking credentials when the remote check fails", async () => {
    prismaMock.storageNode.findUnique.mockResolvedValueOnce({
      id: "node-1",
      driver: "SFTP",
      basePath: "/data/root",
      host: null,
      port: null,
      username: null,
      server: { host: "server-host", port: 22, username: "root", password: "SECRET", sshKeyId: null, sshKey: null },
    });
    listRemoteDirectoryMock.mockRejectedValueOnce(new Error("Auth failed with SECRET"));

    const result = await checkStorageNodeHealth("node-1");

    expect(result.healthStatus).toBe("UNHEALTHY");
    expect(result.lastHealthError).toContain("Auth failed with [REDACTED]");
    expect(result.lastHealthError).not.toContain("SECRET");
  });
});

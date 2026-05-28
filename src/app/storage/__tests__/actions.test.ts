import { beforeEach, describe, expect, it, vi } from "vitest";

const { requirePermissionMock, prismaMock, createFileEntryMock, createRemoteDirectoryMock, mkdirMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn().mockResolvedValue({
    userId: "user-1",
    username: "alice",
    roles: ["operator"],
    mustChangePassword: false,
  }),
  prismaMock: {
    fileEntry: {
      findFirst: vi.fn(),
    },
    storageNode: {
      findUnique: vi.fn(),
    },
  },
  createFileEntryMock: vi.fn(),
  createRemoteDirectoryMock: vi.fn(),
  mkdirMock: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: requirePermissionMock,
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/storage/service", () => ({
  createFileEntry: createFileEntryMock,
  createStorageNode: vi.fn(),
  deleteStorageNode: vi.fn(),
  listStorageNodes: vi.fn(),
  updateLocalFileContent: vi.fn(),
  updateStorageNode: vi.fn(),
}));

vi.mock("@/lib/server/service", () => ({
  listServerProfiles: vi.fn(),
}));

vi.mock("@/lib/ssh/client", () => ({
  createRemoteDirectory: createRemoteDirectoryMock,
}));

vi.mock("node:fs/promises", () => ({
  mkdir: mkdirMock,
}));

import { createFolderAction } from "../actions";

function folderForm(input: { storageNodeId?: string; currentPath?: string; folderName?: string }) {
  const formData = new FormData();
  if (input.storageNodeId !== undefined) formData.set("storageNodeId", input.storageNodeId);
  if (input.currentPath !== undefined) formData.set("currentPath", input.currentPath);
  if (input.folderName !== undefined) formData.set("folderName", input.folderName);
  return formData;
}

describe("createFolderAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermissionMock.mockResolvedValue({
      userId: "user-1",
      username: "alice",
      roles: ["operator"],
      mustChangePassword: false,
    });
  });

  it("rejects unsafe current paths before DB lookups or filesystem writes", async () => {
    const result = await createFolderAction(null, folderForm({
      storageNodeId: "node-1",
      currentPath: "..",
      folderName: "docs",
    }));

    expect(result.error).toMatch(/路径/);
    expect(prismaMock.fileEntry.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.storageNode.findUnique).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(createFileEntryMock).not.toHaveBeenCalled();
  });

  it("normalizes safe folder paths before checking existence and creating SFTP directories", async () => {
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(null);
    prismaMock.storageNode.findUnique.mockResolvedValueOnce({
      id: "node-1",
      name: "remote",
      driver: "SFTP",
      basePath: "/data/root/",
      host: "203.0.113.10",
      port: 22,
      username: "deployer",
      serverId: "srv-1",
      server: {
        connectionType: "SSH_KEY",
        password: null,
        sshKey: { privateKey: "PRIVATE KEY" },
      },
    });
    createFileEntryMock.mockResolvedValueOnce({ id: "folder-1" });

    const result = await createFolderAction(null, folderForm({
      storageNodeId: "node-1",
      currentPath: "team\\alpha",
      folderName: "docs",
    }));

    expect(result).toEqual({ success: "文件夹 /team/alpha/docs 已创建" });
    expect(prismaMock.fileEntry.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ relativePath: "team/alpha/docs" }),
    }));
    expect(createRemoteDirectoryMock).toHaveBeenCalledWith(expect.objectContaining({
      remotePath: "/data/root/team/alpha/docs",
      recursive: true,
    }));
    expect(createFileEntryMock).toHaveBeenCalledWith(expect.objectContaining({
      name: "docs",
      relativePath: "team/alpha/docs",
    }));
  });

  it("creates SFTP folders for password-based nodes", async () => {
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(null);
    prismaMock.storageNode.findUnique.mockResolvedValueOnce({
      id: "node-password",
      name: "remote-password",
      driver: "SFTP",
      basePath: "/data/root",
      host: null,
      port: null,
      username: null,
      serverId: "srv-password",
      server: {
        host: "203.0.113.11",
        port: 2022,
        username: "ops",
        connectionType: "PASSWORD",
        password: "secret",
        sshKey: null,
      },
    });
    createFileEntryMock.mockResolvedValueOnce({ id: "folder-password" });

    const result = await createFolderAction(null, folderForm({
      storageNodeId: "node-password",
      currentPath: "uploads",
      folderName: "batch",
    }));

    expect(result).toEqual({ success: "文件夹 /uploads/batch 已创建" });
    expect(createRemoteDirectoryMock).toHaveBeenCalledWith(expect.objectContaining({
      host: "203.0.113.11",
      port: 2022,
      username: "ops",
      password: "secret",
      remotePath: "/data/root/uploads/batch",
      recursive: true,
    }));
  });
});

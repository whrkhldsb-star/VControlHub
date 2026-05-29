import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requirePermissionMock,
  prismaMock,
  createFileEntryMock,
  createRemoteDirectoryMock,
  deleteRemoteFileMock,
  renameRemoteFileMock,
  mkdirMock,
} = vi.hoisted(() => ({
  requirePermissionMock: vi.fn().mockResolvedValue({
    userId: "user-1",
    username: "alice",
    roles: ["operator"],
    mustChangePassword: false,
  }),
  prismaMock: {
    fileEntry: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    storageNode: {
      findUnique: vi.fn(),
    },
  },
  createFileEntryMock: vi.fn(),
  createRemoteDirectoryMock: vi.fn(),
  deleteRemoteFileMock: vi.fn(),
  renameRemoteFileMock: vi.fn(),
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
  deleteRemoteFile: deleteRemoteFileMock,
  renameRemoteFile: renameRemoteFileMock,
}));

vi.mock("node:fs/promises", () => ({
  mkdir: mkdirMock,
}));

import {
  createFolderAction,
  deleteFileEntryAction,
  permanentDeleteFileEntryAction,
  renameFileEntryAction,
} from "../actions";

function folderForm(input: {
  storageNodeId?: string;
  currentPath?: string;
  folderName?: string;
}) {
  const formData = new FormData();
  if (input.storageNodeId !== undefined)
    formData.set("storageNodeId", input.storageNodeId);
  if (input.currentPath !== undefined)
    formData.set("currentPath", input.currentPath);
  if (input.folderName !== undefined)
    formData.set("folderName", input.folderName);
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
    const result = await createFolderAction(
      null,
      folderForm({
        storageNodeId: "node-1",
        currentPath: "..",
        folderName: "docs",
      }),
    );

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

    const result = await createFolderAction(
      null,
      folderForm({
        storageNodeId: "node-1",
        currentPath: "team\\alpha",
        folderName: "docs",
      }),
    );

    expect(result).toEqual({ success: "文件夹 /team/alpha/docs 已创建" });
    expect(prismaMock.fileEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ relativePath: "team/alpha/docs" }),
      }),
    );
    expect(createRemoteDirectoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        remotePath: "/data/root/team/alpha/docs",
        recursive: true,
      }),
    );
    expect(createFileEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "docs",
        relativePath: "team/alpha/docs",
      }),
    );
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

    const result = await createFolderAction(
      null,
      folderForm({
        storageNodeId: "node-password",
        currentPath: "uploads",
        folderName: "batch",
      }),
    );

    expect(result).toEqual({ success: "文件夹 /uploads/batch 已创建" });
    expect(createRemoteDirectoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "203.0.113.11",
        port: 2022,
        username: "ops",
        password: "secret",
        remotePath: "/data/root/uploads/batch",
        recursive: true,
      }),
    );
  });
});

function entryForm(fileEntryId: string, extra?: Record<string, string>) {
  const formData = new FormData();
  formData.set("fileEntryId", fileEntryId);
  for (const [key, value] of Object.entries(extra ?? {}))
    formData.set(key, value);
  return formData;
}

function sftpEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "entry-1",
    name: "old.txt",
    entryType: "FILE",
    relativePath: "docs/old.txt",
    storageNodeId: "node-sftp",
    storageNode: {
      driver: "SFTP",
      basePath: "/data/root",
      host: null,
      port: null,
      username: null,
      server: {
        host: "203.0.113.10",
        port: 22,
        username: "root",
        connectionType: "SSH_KEY",
        password: null,
        sshKey: { privateKey: "PRIVATE KEY" },
      },
    },
    ...overrides,
  };
}

describe("SFTP file entry actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermissionMock.mockResolvedValue({
      userId: "user-1",
      username: "alice",
      roles: ["operator"],
      mustChangePassword: false,
    });
  });

  it("deletes the remote SFTP file before soft-deleting its DB entry", async () => {
    prismaMock.fileEntry.findUnique.mockResolvedValueOnce(sftpEntry());
    prismaMock.fileEntry.update.mockResolvedValueOnce({ id: "entry-1" });

    const result = await deleteFileEntryAction(null, entryForm("entry-1"));

    expect(result.success).toContain("old.txt");
    expect(deleteRemoteFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "203.0.113.10",
        remotePath: "/data/root/docs/old.txt",
        isDirectory: false,
      }),
    );
    expect(prismaMock.fileEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "entry-1" },
        data: { isDeleted: true },
      }),
    );
  });

  it("permanently deletes the remote SFTP directory before deleting DB rows", async () => {
    prismaMock.fileEntry.findUnique.mockResolvedValueOnce(
      sftpEntry({
        name: "docs",
        entryType: "DIRECTORY",
        relativePath: "docs",
      }),
    );
    prismaMock.fileEntry.deleteMany.mockResolvedValueOnce({ count: 2 });
    prismaMock.fileEntry.delete.mockResolvedValueOnce({ id: "entry-1" });

    const result = await permanentDeleteFileEntryAction(
      null,
      entryForm("entry-1"),
    );

    expect(result.success).toContain("docs");
    expect(deleteRemoteFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        remotePath: "/data/root/docs",
        isDirectory: true,
      }),
    );
    expect(prismaMock.fileEntry.delete).toHaveBeenCalledWith({
      where: { id: "entry-1" },
    });
  });

  it("renames the remote SFTP file before updating indexed paths", async () => {
    prismaMock.fileEntry.findUnique.mockResolvedValueOnce(sftpEntry());
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(null);
    prismaMock.fileEntry.update.mockResolvedValueOnce({ id: "entry-1" });

    const result = await renameFileEntryAction(
      null,
      entryForm("entry-1", { newName: "new.txt" }),
    );

    expect(result.success).toContain("new.txt");
    expect(renameRemoteFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        oldPath: "/data/root/docs/old.txt",
        newPath: "/data/root/docs/new.txt",
      }),
    );
    expect(prismaMock.fileEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "entry-1" },
        data: { name: "new.txt", relativePath: "docs/new.txt" },
      }),
    );
  });
});

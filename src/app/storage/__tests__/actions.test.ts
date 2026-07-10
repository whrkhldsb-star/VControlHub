import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requirePermissionMock,
  prismaMock,
  createFileEntryMock,
  restoreFileEntryMock,
  createRemoteDirectoryMock,
  deleteRemoteFileMock,
  renameRemoteFileMock,
  mkdirMock,
  rmMock,
  unlinkMock,
  renameFsMock,
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
  restoreFileEntryMock: vi.fn(),
  createRemoteDirectoryMock: vi.fn(),
  deleteRemoteFileMock: vi.fn(),
  renameRemoteFileMock: vi.fn(),
  mkdirMock: vi.fn(),
  rmMock: vi.fn(),
  unlinkMock: vi.fn(),
  renameFsMock: vi.fn(),
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
  restoreFileEntry: restoreFileEntryMock,
  createStorageNode: vi.fn(),
  deleteStorageNode: vi.fn(),
  listStorageNodes: vi.fn(),
  updateLocalFileContent: vi.fn(),
  updateStorageNode: vi.fn(),
}));

vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: vi.fn().mockResolvedValue({ allowed: true, storageNode: { id: "sn_team_alpha", userId: "u_1" } }),
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
  rm: rmMock,
  unlink: unlinkMock,
  rename: renameFsMock,
  default: {
    mkdir: mkdirMock,
    rm: rmMock,
    unlink: unlinkMock,
    rename: renameFsMock,
  },
}));

import {
  createFolderAction,
  deleteFileEntryAction,
  permanentDeleteFileEntryAction,
  renameFileEntryAction,
  restoreFileEntryAction,
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

    expect(result.error).toMatch(/Path/);
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

    expect(result).toEqual({ success: "Folder /team/alpha/docs created" });
    expect(prismaMock.fileEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ relativePath: "team/alpha/docs" }),
      }),
    );
    expect(createRemoteDirectoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        remotePath: "/data/root/team/alpha/docs",
        recursive: false,
      }),
    );
    expect(createFileEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "docs",
        relativePath: "team/alpha/docs",
      }),
    );
  });

  it("rolls back a newly-created local folder when indexing fails", async () => {
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(null);
    prismaMock.storageNode.findUnique.mockResolvedValueOnce({
      id: "node-local",
      name: "local",
      driver: "LOCAL",
      basePath: "/srv/storage",
      host: null,
      port: null,
      username: null,
      server: null,
    });
    mkdirMock.mockResolvedValueOnce(undefined);
    createFileEntryMock.mockRejectedValueOnce(new Error("Index write failed"));

    const result = await createFolderAction(
      null,
      folderForm({
        storageNodeId: "node-local",
        currentPath: "docs",
        folderName: "drafts",
      }),
    );

    expect(result).toEqual({ error: "Index write failed" });
    expect(mkdirMock).toHaveBeenCalledWith("/srv/storage/docs/drafts", {
      recursive: false,
    });
    expect(rmMock).toHaveBeenCalledWith("/srv/storage/docs/drafts", {
      recursive: true,
      force: false,
    });
  });

  it("rolls back a newly-created SFTP folder when indexing fails", async () => {
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(null);
    prismaMock.storageNode.findUnique.mockResolvedValueOnce({
      id: "node-sftp",
      name: "remote",
      driver: "SFTP",
      basePath: "/data/root",
      host: null,
      port: null,
      username: null,
      serverId: "srv-1",
      server: {
        host: "203.0.113.10",
        port: 22,
        username: "root",
        connectionType: "SSH_KEY",
        password: null,
        sshKey: { privateKey: "PRIVATE KEY" },
      },
    });
    createRemoteDirectoryMock.mockResolvedValueOnce(undefined);
    createFileEntryMock.mockRejectedValueOnce(new Error("Index write failed"));

    const result = await createFolderAction(
      null,
      folderForm({
        storageNodeId: "node-sftp",
        currentPath: "team",
        folderName: "drafts",
      }),
    );

    expect(result).toEqual({ error: "Index write failed" });
    expect(createRemoteDirectoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        remotePath: "/data/root/team/drafts",
        recursive: false,
      }),
    );
    expect(deleteRemoteFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        remotePath: "/data/root/team/drafts",
        isDirectory: true,
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

  it("soft-deletes the indexed SFTP entry before deleting the remote backing file", async () => {
    prismaMock.fileEntry.findUnique.mockResolvedValueOnce(sftpEntry());
    prismaMock.fileEntry.update.mockResolvedValueOnce({ id: "entry-1" });

    const result = await deleteFileEntryAction(null, entryForm("entry-1"));

    expect(result.success).toContain("old.txt");
    expect(prismaMock.fileEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "entry-1" },
        data: { isDeleted: true },
      }),
    );
    expect(deleteRemoteFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "203.0.113.10",
        remotePath: "/data/root/docs/old.txt",
        isDirectory: false,
      }),
    );
  });

  it("does not delete the backing file when recycle-bin indexing fails", async () => {
    prismaMock.fileEntry.findUnique.mockResolvedValueOnce(sftpEntry());
    prismaMock.fileEntry.update.mockRejectedValueOnce(new Error("database unavailable"));

    const result = await deleteFileEntryAction(null, entryForm("entry-1"));

    expect(result).toEqual({ error: "database unavailable" });
    expect(deleteRemoteFileMock).not.toHaveBeenCalled();
  });

  it("restores through the storage service so physical existence is checked", async () => {
    prismaMock.fileEntry.findUnique.mockResolvedValueOnce(sftpEntry());
    restoreFileEntryMock.mockResolvedValueOnce({ id: "entry-1" });

    const result = await restoreFileEntryAction(null, entryForm("entry-1"));

    expect(result).toEqual({ success: "old.txt restored" });
    expect(restoreFileEntryMock).toHaveBeenCalledWith({ fileEntryId: "entry-1" });
    expect(prismaMock.fileEntry.update).not.toHaveBeenCalled();
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

  it("permanent SFTP delete tolerates an already-missing remote file and still removes the recycle-bin row", async () => {
    prismaMock.fileEntry.findUnique.mockResolvedValueOnce(sftpEntry());
    deleteRemoteFileMock.mockRejectedValueOnce(
      Object.assign(new Error("No such file"), { code: "ENOENT" }),
    );
    prismaMock.fileEntry.delete.mockResolvedValueOnce({ id: "entry-1" });

    const result = await permanentDeleteFileEntryAction(
      null,
      entryForm("entry-1"),
    );

    expect(result).toEqual({ success: "old.txt permanently deleted" });
    expect(deleteRemoteFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        remotePath: "/data/root/docs/old.txt",
        isDirectory: false,
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

    expect(renameFsMock).not.toHaveBeenCalled();
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

  it("keeps the DB entry in recycle bin when LOCAL backing deletion fails", async () => {
    prismaMock.fileEntry.findUnique.mockResolvedValueOnce({
      id: "local-file",
      name: "report.txt",
      entryType: "FILE",
      relativePath: "reports/report.txt",
      storageNodeId: "node-local",
      storageNode: {
        driver: "LOCAL",
        basePath: "/srv/storage",
        host: null,
        port: null,
        username: null,
        server: null,
      },
    });
    prismaMock.fileEntry.update.mockResolvedValueOnce({ id: "local-file" });
    unlinkMock.mockRejectedValueOnce(new Error("disk busy"));

    const result = await deleteFileEntryAction(null, entryForm("local-file"));

    expect(unlinkMock).toHaveBeenCalledWith("/srv/storage/reports/report.txt");
    expect(prismaMock.fileEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "local-file" },
        data: { isDeleted: true },
      }),
    );
    expect(result.success).toContain("report.txt moved to recycle bin");
    expect(result.success).toContain("physical file deletion failed");
    expect(result.success).toContain("disk busy");
  });

  it("renames LOCAL files on disk before updating indexed paths", async () => {
    prismaMock.fileEntry.findUnique.mockResolvedValueOnce({
      id: "local-file",
      name: "old.txt",
      entryType: "FILE",
      relativePath: "docs/old.txt",
      storageNodeId: "node-local",
      storageNode: {
        driver: "LOCAL",
        basePath: "/srv/storage",
        host: null,
        port: null,
        username: null,
        server: null,
      },
    });
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(null);
    renameFsMock.mockResolvedValueOnce(undefined);
    prismaMock.fileEntry.update.mockResolvedValueOnce({ id: "local-file" });

    const result = await renameFileEntryAction(
      null,
      entryForm("local-file", { newName: "new.txt" }),
    );

    expect(result).toEqual({ success: "Renamed to new.txt" });
    expect(mkdirMock).toHaveBeenCalledWith("/srv/storage/docs", {
      recursive: true,
    });
    expect(renameFsMock).toHaveBeenCalledWith(
      "/srv/storage/docs/old.txt",
      "/srv/storage/docs/new.txt",
    );
    expect(prismaMock.fileEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "local-file" },
        data: { name: "new.txt", relativePath: "docs/new.txt" },
      }),
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createRemoteDirectoryMock,
  renameRemoteFileMock,
  resolveStorageSshCredentialsMock,
  normalizeRemoteTargetPathMock,
  mkdirMock,
  renameFsMock,
  fsMock,
} = vi.hoisted(() => {
  const createRemoteDirectoryMock = vi.fn();
  const renameRemoteFileMock = vi.fn();
  const resolveStorageSshCredentialsMock = vi.fn();
  const normalizeRemoteTargetPathMock = vi.fn(
    (base: string, rel: string) =>
      `${base.replace(/\/$/, "")}/${rel.replace(/^\/+/, "")}`,
  );
  const mkdirMock = vi.fn();
  const rmMock = vi.fn();
  const unlinkMock = vi.fn();
  const renameFsMock = vi.fn();
  const statMock = vi.fn();
  const lstatMock = vi.fn();
  const readFileMock = vi.fn();
  const writeFileMock = vi.fn();
  const readdirMock = vi.fn();
  const fsMock = {
    mkdir: mkdirMock,
    rm: rmMock,
    unlink: unlinkMock,
    rename: renameFsMock,
    stat: statMock,
    lstat: lstatMock,
    readFile: readFileMock,
    writeFile: writeFileMock,
    readdir: readdirMock,
    default: {
      mkdir: mkdirMock,
      rm: rmMock,
      unlink: unlinkMock,
      rename: renameFsMock,
    },
  };
  return {
    createRemoteDirectoryMock,
    renameRemoteFileMock,
    resolveStorageSshCredentialsMock,
    normalizeRemoteTargetPathMock,
    mkdirMock,
    renameFsMock,
    fsMock,
  };
});

vi.mock("@/lib/ssh/client", () => ({
  createRemoteDirectory: createRemoteDirectoryMock,
  renameRemoteFile: renameRemoteFileMock,
}));

vi.mock("@/lib/storage/remote-path", () => ({
  normalizeRemoteTargetPath: normalizeRemoteTargetPathMock,
}));

vi.mock("@/lib/storage/ssh-credentials", () => ({
  resolveStorageSshCredentials: resolveStorageSshCredentialsMock,
}));

vi.mock("node:fs/promises", () => fsMock);

import { moveBackingObject } from "../fs-backend";

const localNode = {
  id: "node-local",
  driver: "LOCAL",
  basePath: "/srv/storage",
  host: null,
  port: null,
  username: null,
  server: null,
} as const;

const sftpNode = {
  id: "node-sftp",
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
} as const;

describe("moveBackingObject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveStorageSshCredentialsMock.mockReturnValue({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      privateKey: "PRIVATE KEY",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("moves a LOCAL file and creates the destination parent directory", async () => {
    await moveBackingObject({
      storageNode: localNode,
      oldRelativePath: "docs/old.txt",
      newRelativePath: "team/sub/new.txt",
    });
    expect(mkdirMock).toHaveBeenCalledWith("/srv/storage/team/sub", {
      recursive: true,
    });
    expect(renameFsMock).toHaveBeenCalledWith(
      "/srv/storage/docs/old.txt",
      "/srv/storage/team/sub/new.txt",
    );
    expect(createRemoteDirectoryMock).not.toHaveBeenCalled();
    expect(renameRemoteFileMock).not.toHaveBeenCalled();
  });

  it("moves an SFTP file and creates the destination parent directory recursively", async () => {
    await moveBackingObject({
      storageNode: sftpNode,
      oldRelativePath: "docs/old.txt",
      newRelativePath: "team/sub/new.txt",
    });
    expect(createRemoteDirectoryMock).toHaveBeenCalledWith({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      privateKey: "PRIVATE KEY",
      remotePath: "/data/root/team/sub",
      recursive: true,
    });
    expect(renameRemoteFileMock).toHaveBeenCalledWith({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      privateKey: "PRIVATE KEY",
      oldPath: "/data/root/docs/old.txt",
      newPath: "/data/root/team/sub/new.txt",
    });
  });

  it("creates the storage-root parent when the destination is directly inside it", async () => {
    await moveBackingObject({
      storageNode: sftpNode,
      oldRelativePath: "old.txt",
      newRelativePath: "new.txt",
    });
    expect(createRemoteDirectoryMock).toHaveBeenCalledWith({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      privateKey: "PRIVATE KEY",
      remotePath: "/data/root",
      recursive: true,
    });
    expect(renameRemoteFileMock).toHaveBeenCalledWith({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      privateKey: "PRIVATE KEY",
      oldPath: "/data/root/old.txt",
      newPath: "/data/root/new.txt",
    });
  });

  it("propagates normalizeRemoteTargetPath errors for SFTP", async () => {
    normalizeRemoteTargetPathMock.mockImplementationOnce(() => {
      throw new Error("请求路径超出存储节点根目录");
    });
    await expect(
      moveBackingObject({
        storageNode: sftpNode,
        oldRelativePath: "docs/old.txt",
        newRelativePath: "../etc/evil",
      }),
    ).rejects.toThrow(/存储节点根目录/);
    expect(createRemoteDirectoryMock).not.toHaveBeenCalled();
    expect(renameRemoteFileMock).not.toHaveBeenCalled();
  });

  it("propagates renameRemoteFile errors for SFTP", async () => {
    renameRemoteFileMock.mockRejectedValueOnce(new Error("rename failed"));
    await expect(
      moveBackingObject({
        storageNode: sftpNode,
        oldRelativePath: "docs/old.txt",
        newRelativePath: "team/new.txt",
      }),
    ).rejects.toThrow(/rename failed/);
  });

  it("is a no-op for unsupported drivers", async () => {
    await moveBackingObject({
      storageNode: { ...localNode, driver: "WEBDAV" as never },
      oldRelativePath: "docs/old.txt",
      newRelativePath: "team/new.txt",
    });
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(renameFsMock).not.toHaveBeenCalled();
    expect(createRemoteDirectoryMock).not.toHaveBeenCalled();
    expect(renameRemoteFileMock).not.toHaveBeenCalled();
  });
});

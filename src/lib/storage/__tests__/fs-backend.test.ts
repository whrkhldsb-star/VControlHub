import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** LOCAL driver paths resolve through node:path — build expectations natively. */
const localPath = (...segments: string[]) => path.resolve("/srv/storage", ...segments);

const {
  createRemoteDirectoryMock,
  deleteRemoteFileMock,
  renameRemoteFileMock,
  writeRemoteFileMock,
  readRemoteFileMock,
  resolveStorageSshCredentialsMock,
  normalizeRemoteTargetPathMock,
  mkdirMock,
  rmMock,
  unlinkMock,
  renameFsMock,
  writeFileMock,
  readFileMock,
  fsMock,
} = vi.hoisted(() => {
  const createRemoteDirectoryMock = vi.fn();
  const deleteRemoteFileMock = vi.fn();
  const renameRemoteFileMock = vi.fn();
  const writeRemoteFileMock = vi.fn();
  const readRemoteFileMock = vi.fn();
  const resolveStorageSshCredentialsMock = vi.fn();
  const normalizeRemoteTargetPathMock = vi.fn(
    (base: string, rel: string) =>
      `${base.replace(/\/$/, "")}/${rel.replace(/^\/+/, "")}`,
  );
  const mkdirMock = vi.fn();
  const rmMock = vi.fn();
  const unlinkMock = vi.fn();
  const renameFsMock = vi.fn();
  const writeFileMock = vi.fn();
  const statMock = vi.fn();
  const lstatMock = vi.fn();
  const readFileMock = vi.fn();
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
      writeFile: writeFileMock,
      readFile: readFileMock,
    },
  };
  return {
    createRemoteDirectoryMock,
    deleteRemoteFileMock,
    renameRemoteFileMock,
    writeRemoteFileMock,
    readRemoteFileMock,
    resolveStorageSshCredentialsMock,
    normalizeRemoteTargetPathMock,
    mkdirMock,
    rmMock,
    unlinkMock,
    renameFsMock,
    writeFileMock,
    readFileMock,
    fsMock,
  };
});

vi.mock("@/lib/ssh/client", () => ({
  createRemoteDirectory: createRemoteDirectoryMock,
  deleteRemoteFile: deleteRemoteFileMock,
  renameRemoteFile: renameRemoteFileMock,
  writeRemoteFile: writeRemoteFileMock,
  readRemoteFile: readRemoteFileMock,
}));

vi.mock("@/lib/storage/remote-path", () => ({
  normalizeRemoteTargetPath: normalizeRemoteTargetPathMock,
}));

vi.mock("@/lib/storage/ssh-credentials", () => ({
  resolveStorageSshCredentials: resolveStorageSshCredentialsMock,
}));

vi.mock("node:fs/promises", () => fsMock);

import {
  createManagedFolder,
  deleteBackingObject,
  isMissingBackingObjectError,
  readBackingObject,
  renameBackingObject,
  resolveManagedLocalEntryPath,
  writeBackingObject,
} from "../fs-backend";

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

describe("isMissingBackingObjectError", () => {
  it("matches fs error codes ENOENT and 2", () => {
    const err = new Error("missing") as Error & { code?: string };
    err.code = "ENOENT";
    expect(isMissingBackingObjectError(err)).toBe(true);
    const err2 = new Error("missing") as Error & { code?: number };
    err2.code = 2;
    expect(isMissingBackingObjectError(err2)).toBe(true);
  });

  it("matches common 'not found' error messages", () => {
    expect(
      isMissingBackingObjectError(new Error("No such file or directory")),
    ).toBe(true);
    expect(
      isMissingBackingObjectError(new Error("file does not exist")),
    ).toBe(true);
    expect(isMissingBackingObjectError(new Error("文件不存在"))).toBe(true);
    expect(isMissingBackingObjectError(new Error("no_such_file"))).toBe(true);
  });

  it("rejects unrelated errors and non-Error throwables", () => {
    expect(isMissingBackingObjectError(new Error("permission denied"))).toBe(
      false,
    );
    expect(isMissingBackingObjectError("ENOENT")).toBe(false);
    expect(isMissingBackingObjectError(null)).toBe(false);
  });
});

describe("resolveManagedLocalEntryPath", () => {
  it("joins a base path with a relative path", async () => {
    const result = await resolveManagedLocalEntryPath({
      basePath: "/srv/storage",
      relativePath: "team/docs/file.txt",
    });
    expect(result.absolutePath).toBe(localPath("team/docs/file.txt"));
  });

  it("rejects relative paths that escape the base path", async () => {
    await expect(
      resolveManagedLocalEntryPath({
        basePath: "/srv/storage",
        relativePath: "../etc/passwd",
      }),
    ).rejects.toThrow(/路径超出存储根目录|exceeds storage root/);
  });

  it("strips leading slashes from the relative path before joining", async () => {
    const result = await resolveManagedLocalEntryPath({
      basePath: "/srv/storage",
      relativePath: "/team/docs",
    });
    expect(result.absolutePath).toBe(localPath("team/docs"));
  });
});

describe("createManagedFolder", () => {
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

  it("initializes the LOCAL root before creating a folder non-recursively", async () => {
    await createManagedFolder({
      storageNode: localNode,
      relativePath: "team/drafts",
    });
    expect(mkdirMock).toHaveBeenNthCalledWith(1, localPath(), {
      recursive: true,
    });
    expect(mkdirMock).toHaveBeenNthCalledWith(2, localPath("team/drafts"), {
      recursive: false,
    });
    expect(createRemoteDirectoryMock).not.toHaveBeenCalled();
  });

  it("creates an SFTP folder with createRemoteDirectory", async () => {
    await createManagedFolder({
      storageNode: sftpNode,
      relativePath: "team/drafts",
    });
    expect(createRemoteDirectoryMock).toHaveBeenCalledWith({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      privateKey: "PRIVATE KEY",
      remotePath: "/data/root/team/drafts",
      recursive: false,
    });
    expect(mkdirMock).not.toHaveBeenCalled();
  });

  it("propagates the error from normalizeRemoteTargetPath for SFTP", async () => {
    normalizeRemoteTargetPathMock.mockImplementationOnce(() => {
      throw new Error("请求路径超出存储节点根目录");
    });
    await expect(
      createManagedFolder({
        storageNode: sftpNode,
        relativePath: "../etc",
      }),
    ).rejects.toThrow(/存储节点根目录/);
  });
});

describe("readBackingObject", () => {
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

  it("reads a LOCAL file via readFile after path containment", async () => {
    readFileMock.mockResolvedValueOnce(Buffer.from("hello local"));
    const buffer = await readBackingObject({
      storageNode: localNode,
      relativePath: "team/docs/a.txt",
    });
    expect(readFileMock).toHaveBeenCalledWith(localPath("team/docs/a.txt"));
    expect(buffer.toString("utf8")).toBe("hello local");
    expect(readRemoteFileMock).not.toHaveBeenCalled();
  });

  it("reads an SFTP file via readRemoteFile with resolved credentials", async () => {
    readRemoteFileMock.mockResolvedValueOnce(Buffer.from("hello sftp"));
    const buffer = await readBackingObject({
      storageNode: sftpNode,
      relativePath: "team/docs/a.txt",
    });
    expect(readRemoteFileMock).toHaveBeenCalledWith({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      privateKey: "PRIVATE KEY",
      remotePath: "/data/root/team/docs/a.txt",
    });
    expect(buffer.toString("utf8")).toBe("hello sftp");
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported drivers instead of returning empty success", async () => {
    await expect(
      readBackingObject({
        storageNode: { ...localNode, driver: "UNSUPPORTED" },
        relativePath: "x.txt",
      }),
    ).rejects.toThrow(/Unsupported storage driver for read/);
  });
});

describe("deleteBackingObject", () => {
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

  it("unlinks a LOCAL file (isDirectory=false)", async () => {
    await deleteBackingObject({
      storageNode: localNode,
      relativePath: "docs/file.txt",
      isDirectory: false,
      tolerateMissing: false,
    });
    expect(unlinkMock).toHaveBeenCalledWith(localPath("docs/file.txt"));
    expect(rmMock).not.toHaveBeenCalled();
    expect(deleteRemoteFileMock).not.toHaveBeenCalled();
  });

  it("rm -r a LOCAL directory (isDirectory=true)", async () => {
    await deleteBackingObject({
      storageNode: localNode,
      relativePath: "docs/drafts",
      isDirectory: true,
      tolerateMissing: false,
    });
    expect(rmMock).toHaveBeenCalledWith(localPath("docs/drafts"), {
      recursive: true,
      force: false,
    });
    expect(unlinkMock).not.toHaveBeenCalled();
  });

  it("calls deleteRemoteFile for SFTP", async () => {
    await deleteBackingObject({
      storageNode: sftpNode,
      relativePath: "docs/file.txt",
      isDirectory: false,
      tolerateMissing: false,
    });
    expect(deleteRemoteFileMock).toHaveBeenCalledWith({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      privateKey: "PRIVATE KEY",
      remotePath: "/data/root/docs/file.txt",
      isDirectory: false,
    });
  });

  it("swallows missing-file errors when tolerateMissing=true", async () => {
    unlinkMock.mockRejectedValueOnce(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
    await expect(
      deleteBackingObject({
        storageNode: localNode,
        relativePath: "docs/missing.txt",
        isDirectory: false,
        tolerateMissing: true,
      }),
    ).resolves.toBeUndefined();
  });

  it("rethrows unrelated errors even when tolerateMissing=true", async () => {
    unlinkMock.mockRejectedValueOnce(new Error("permission denied"));
    await expect(
      deleteBackingObject({
        storageNode: localNode,
        relativePath: "docs/file.txt",
        isDirectory: false,
        tolerateMissing: true,
      }),
    ).rejects.toThrow(/permission/);
  });

  it("rethrows missing-file errors when tolerateMissing=false", async () => {
    unlinkMock.mockRejectedValueOnce(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
    await expect(
      deleteBackingObject({
        storageNode: localNode,
        relativePath: "docs/missing.txt",
        isDirectory: false,
        tolerateMissing: false,
      }),
    ).rejects.toThrow(/missing/);
  });
});

describe("renameBackingObject", () => {
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

  it("renames a LOCAL file with mkdir parent (recursive)", async () => {
    await renameBackingObject({
      storageNode: localNode,
      oldRelativePath: "docs/old.txt",
      newRelativePath: "team/new.txt",
    });
    expect(mkdirMock).toHaveBeenCalledWith(localPath("team"), {
      recursive: true,
    });
    expect(renameFsMock).toHaveBeenCalledWith(
      localPath("docs/old.txt"),
      localPath("team/new.txt"),
    );
    expect(renameRemoteFileMock).not.toHaveBeenCalled();
  });

  it("renames an SFTP file with renameRemoteFile", async () => {
    await renameBackingObject({
      storageNode: sftpNode,
      oldRelativePath: "docs/old.txt",
      newRelativePath: "team/new.txt",
    });
    expect(renameRemoteFileMock).toHaveBeenCalledWith({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      privateKey: "PRIVATE KEY",
      oldPath: "/data/root/docs/old.txt",
      newPath: "/data/root/team/new.txt",
    });
  });
});

describe("writeBackingObject", () => {
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

  it("writes a LOCAL file after mkdir -p parent and returns byteSize", async () => {
    const result = await writeBackingObject({
      storageNode: localNode,
      relativePath: "team/docs/note.txt",
      content: "hello",
    });
    expect(result).toEqual({ byteSize: 5 });
    expect(mkdirMock).toHaveBeenCalledWith(localPath("team/docs"), {
      recursive: true,
    });
    expect(writeFileMock).toHaveBeenCalledWith(
      localPath("team/docs/note.txt"),
      Buffer.from("hello", "utf8"),
    );
    expect(writeRemoteFileMock).not.toHaveBeenCalled();
  });

  it("writes an SFTP file after creating the parent directory", async () => {
    const result = await writeBackingObject({
      storageNode: sftpNode,
      relativePath: "new-folder/hello.txt",
      content: "hello",
    });
    expect(result).toEqual({ byteSize: 5 });
    expect(createRemoteDirectoryMock).toHaveBeenCalledWith({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      privateKey: "PRIVATE KEY",
      remotePath: "/data/root/new-folder",
      recursive: true,
    });
    expect(writeRemoteFileMock).toHaveBeenCalledWith({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      privateKey: "PRIVATE KEY",
      remotePath: "/data/root/new-folder/hello.txt",
      content: Buffer.from("hello", "utf8"),
    });
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("accepts Buffer content without re-encoding", async () => {
    const buf = Buffer.from([0x00, 0xff, 0x01]);
    const result = await writeBackingObject({
      storageNode: localNode,
      relativePath: "bin/data.bin",
      content: buf,
    });
    expect(result).toEqual({ byteSize: 3 });
    expect(writeFileMock).toHaveBeenCalledWith(
      localPath("bin/data.bin"),
      buf,
    );
  });

  it("rejects LOCAL relative paths that escape the base path", async () => {
    await expect(
      writeBackingObject({
        storageNode: localNode,
        relativePath: "../etc/passwd",
        content: "x",
      }),
    ).rejects.toThrow(/路径超出存储根目录|exceeds storage root/);
  });
});

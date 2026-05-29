import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireApiPermissionMock,
  assertStorageAccessMock,
  prismaMock,
  mkdirMock,
  writeFileMock,
  unlinkMock,
  accessMock,
  statMock,
  createRemoteDirectoryMock,
  writeRemoteFileMock,
  deleteRemoteFileMock,
} = vi.hoisted(() => ({
  requireApiPermissionMock: vi.fn(),
  assertStorageAccessMock: vi.fn(() => Promise.resolve({ allowed: true })),
  prismaMock: {
    storageNode: {
      findUnique: vi.fn(),
    },
    fileEntry: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
  mkdirMock: vi.fn(),
  writeFileMock: vi.fn(),
  unlinkMock: vi.fn(),
  accessMock: vi.fn(),
  statMock: vi.fn(),
  createRemoteDirectoryMock: vi.fn(),
  writeRemoteFileMock: vi.fn(),
  deleteRemoteFileMock: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    createReadStream: vi.fn(() => new ReadableStream()),
  },
  createReadStream: vi.fn(() => new ReadableStream()),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    access: accessMock,
    mkdir: mkdirMock,
    stat: statMock,
    writeFile: writeFileMock,
    unlink: unlinkMock,
  },
  access: accessMock,
  mkdir: mkdirMock,
  stat: statMock,
  writeFile: writeFileMock,
  unlink: unlinkMock,
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

vi.mock("@/lib/ssh/client", () => ({
  createRemoteDirectory: createRemoteDirectoryMock,
  writeRemoteFile: writeRemoteFileMock,
  deleteRemoteFile: deleteRemoteFileMock,
}));

vi.mock("@/lib/ssh/ssh-key-crypto", () => ({
  decryptServerPassword: (value: string) => value,
  decryptSshPrivateKey: (value: string) => value,
}));

import { GET, POST } from "../route";

const session = {
  userId: "u_1",
  username: "admin",
  roles: ["admin"],
  mustChangePassword: false,
};

function uploadForm(relativePath: string) {
  const formData = new FormData();
  formData.set("storageNodeId", "node_1");
  formData.set("relativePath", relativePath);
  formData.set(
    "file",
    new File(["hello world"], "notes.txt", { type: "text/plain" }),
  );
  return formData;
}

describe("/api/storage/local", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValue({ session });
    statMock.mockResolvedValue({ isFile: () => true, size: 11 });
  });

  it("returns 400 when path is missing", async () => {
    const response = await GET(
      new Request("https://example.com/api/storage/local"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "缺少 path 参数",
    });
  });

  it("rejects unsafe download paths before DB lookup", async () => {
    const response = await GET(
      new Request("https://example.com/api/storage/local?path=..%2Fsecret.txt"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/路径/),
    });
    expect(prismaMock.fileEntry.findFirst).not.toHaveBeenCalled();
  });

  it("returns 404 when local file entry is not registered", async () => {
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(null);

    const response = await GET(
      new Request(
        "https://example.com/api/storage/local?path=docs%2Fnotes.txt",
      ),
    );

    expect(prismaMock.fileEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ relativePath: "docs/notes.txt" }),
      }),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "文件条目不存在，或未登记为本机存储文件",
    });
  });

  it("normalizes safe Windows-style upload paths and creates a file entry", async () => {
    prismaMock.storageNode.findUnique.mockResolvedValueOnce({
      id: "node_1",
      name: "主控本机",
      driver: "LOCAL",
      basePath: "/tmp/storage",
    });
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(null);
    prismaMock.fileEntry.create.mockResolvedValueOnce({ id: "file_1" });

    const response = await POST(
      new Request("https://example.com/api/storage/local", {
        method: "POST",
        body: uploadForm("docs\\notes.txt"),
      }),
    );

    expect(response.status).toBe(200);
    expect(assertStorageAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        relativePath: "docs/notes.txt",
        operation: "write",
      }),
    );
    expect(prismaMock.fileEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "notes.txt",
          relativePath: "docs/notes.txt",
        }),
      }),
    );
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      storageNodeId: "node_1",
      relativePath: "docs/notes.txt",
    });
    expect(payload.size).toEqual(expect.any(Number));
    expect(payload.size).toBeGreaterThan(0);
  });

  it("uploads files to SFTP nodes through the same endpoint", async () => {
    prismaMock.storageNode.findUnique.mockResolvedValueOnce({
      id: "node_1",
      name: "远端媒体库",
      driver: "SFTP",
      basePath: "/data/storage",
      host: null,
      port: null,
      username: null,
      server: {
        host: "203.0.113.20",
        port: 2222,
        username: "deploy",
        connectionType: "PASSWORD",
        password: "secret",
        sshKey: null,
      },
    });
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(null);
    prismaMock.fileEntry.create.mockResolvedValueOnce({ id: "file_1" });

    const response = await POST(
      new Request("https://example.com/api/storage/local", {
        method: "POST",
        body: uploadForm("nested/docs/notes.txt"),
      }),
    );

    expect(response.status).toBe(200);
    expect(assertStorageAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        storageNodeId: "node_1",
        relativePath: "nested/docs/notes.txt",
        operation: "write",
      }),
    );
    expect(createRemoteDirectoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "203.0.113.20",
        port: 2222,
        username: "deploy",
        password: "secret",
        remotePath: "/data/storage/nested/docs",
        recursive: true,
      }),
    );
    expect(writeRemoteFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        remotePath: "/data/storage/nested/docs/notes.txt",
        content: expect.any(Buffer),
      }),
    );
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(prismaMock.fileEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          storageNodeId: "node_1",
          name: "notes.txt",
          relativePath: "nested/docs/notes.txt",
        }),
      }),
    );
  });

  it("cleans up SFTP uploads when DB indexing fails after the remote write", async () => {
    prismaMock.storageNode.findUnique.mockResolvedValueOnce({
      id: "node_1",
      name: "远端媒体库",
      driver: "SFTP",
      basePath: "/data/storage",
      host: null,
      port: null,
      username: null,
      server: {
        host: "203.0.113.20",
        port: 2222,
        username: "deploy",
        connectionType: "PASSWORD",
        password: "secret",
        sshKey: null,
      },
    });
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(null);
    prismaMock.fileEntry.create.mockRejectedValueOnce(new Error("db down"));

    const response = await POST(
      new Request("https://example.com/api/storage/local", {
        method: "POST",
        body: uploadForm("nested/docs/notes.txt"),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("上传索引写入失败"),
    });
    expect(deleteRemoteFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "203.0.113.20",
        remotePath: "/data/storage/nested/docs/notes.txt",
      }),
    );
  });

  it("cleans up LOCAL uploads when DB indexing fails after the disk write", async () => {
    prismaMock.storageNode.findUnique.mockResolvedValueOnce({
      id: "node_1",
      name: "主控本机",
      driver: "LOCAL",
      basePath: "/tmp/storage",
    });
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(null);
    prismaMock.fileEntry.create.mockRejectedValueOnce(new Error("db down"));

    const response = await POST(
      new Request("https://example.com/api/storage/local", {
        method: "POST",
        body: uploadForm("docs/notes.txt"),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("上传索引写入失败"),
    });
    expect(unlinkMock).toHaveBeenCalledWith("/tmp/storage/docs/notes.txt");
  });

  it("rejects unsafe upload relativePath before storage node lookup or writes", async () => {
    const response = await POST(
      new Request("https://example.com/api/storage/local", {
        method: "POST",
        body: uploadForm("/etc/passwd"),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/路径/),
    });
    expect(prismaMock.storageNode.findUnique).not.toHaveBeenCalled();
    expect(assertStorageAccessMock).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(prismaMock.fileEntry.create).not.toHaveBeenCalled();
  });

  it("returns 200 with RFC 5987 content-disposition for Chinese filename downloads", async () => {
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce({
      id: "file_cn",
      name: "新建文档.docx",
      relativePath: "新建文档.docx",
      entryType: "FILE",
      mimeType: null,
      storageNode: {
        id: "node_1",
        name: "本机存储",
        basePath: "/tmp/storage",
        driver: "LOCAL",
      },
    });

    const response = await GET(
      new Request(
        "https://example.com/api/storage/local?path=%E6%96%B0%E5%BB%BA%E6%96%87%E6%A1%A3.docx",
      ),
    );

    expect(response.status).toBe(200);
    const cd = response.headers.get("content-disposition");
    expect(cd).toContain("filename*=UTF-8''");
    expect(cd).toContain(encodeURIComponent("新建文档.docx"));
  });
});

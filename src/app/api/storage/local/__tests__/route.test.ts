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
      findFirst: vi.fn(),
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

function uploadForm(relativePath: string, file: File = new File(["hello world"], "notes.txt", { type: "text/plain" })) {
  const formData = new FormData();
  formData.set("storageNodeId", "node_1");
  formData.set("relativePath", relativePath);
  formData.set("file", file);
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
      error: "Missing path parameter",
    });
  });

  it("rejects unsafe download paths before DB lookup", async () => {
    const response = await GET(
      new Request("https://example.com/api/storage/local?path=..%2Fsecret.txt"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Path must not contain . or ..",
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
        where: expect.objectContaining({
          relativePath: "docs/notes.txt",
          storageNode: expect.objectContaining({
            driver: "LOCAL",
          }),
        }),
      }),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "file entry not found, or not registered as local storage file",
    });
  });

  it("team-scopes local download fileEntry lookup via storageNode relation", async () => {
    requireApiPermissionMock.mockResolvedValueOnce({
      session: {
        userId: "u_ops",
        username: "ops",
        roles: ["operator"],
        mustChangePassword: false,
        currentTeamId: "team_a",
      },
    });
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(null);

    await GET(
      new Request(
        "https://example.com/api/storage/local?path=docs%2Fnotes.txt",
      ),
    );

    expect(prismaMock.fileEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storageNode: expect.objectContaining({
            driver: "LOCAL",
            OR: [{ teamId: "team_a" }, { teamId: null }],
          }),
        }),
      }),
    );
  });
  it("normalizes safe Windows-style upload paths and creates a file entry", async () => {
    prismaMock.storageNode.findUnique.mockResolvedValueOnce({
      id: "node_1",
      name: "主控本机",
      driver: "LOCAL",
      basePath: "/tmp/storage",
    });
    prismaMock.storageNode.findFirst.mockResolvedValueOnce({
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
    prismaMock.storageNode.findFirst.mockResolvedValueOnce({
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

  it("rejects oversized uploads before reading the file body into memory", async () => {
    const file = {
      name: "huge.bin",
      type: "application/octet-stream",
      size: 100 * 1024 * 1024 + 1,
      arrayBuffer: vi.fn(async () => new ArrayBuffer(1)),
    };
    const formData = {
      get: (key: string) => {
        if (key === "storageNodeId") return "node_1";
        if (key === "relativePath") return "huge.bin";
        if (key === "file") return file;
        return null;
      },
    };

    const response = await POST({
      url: "https://example.com/api/storage/local",
      headers: new Headers(),
      formData: async () => formData,
    } as unknown as Request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("upload file exceeds 100 MB"),
      maxUploadBytes: 100 * 1024 * 1024,
    });
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(prismaMock.storageNode.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.storageNode.findFirst).not.toHaveBeenCalled();
    expect(assertStorageAccessMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(writeRemoteFileMock).not.toHaveBeenCalled();
  });

  it("cleans up SFTP uploads when DB indexing fails after the remote write", async () => {
    // i18n: error message now in English ("Failed to write upload index: ...")
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
    prismaMock.storageNode.findFirst.mockResolvedValueOnce({
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
      error: expect.stringContaining("Failed to write upload index"),
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
    prismaMock.storageNode.findFirst.mockResolvedValueOnce({
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
      error: expect.stringContaining("Failed to write upload index"),
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
      error: "Path must be a relative path",
    });
    expect(prismaMock.storageNode.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.storageNode.findFirst).not.toHaveBeenCalled();
    expect(assertStorageAccessMock).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(prismaMock.fileEntry.create).not.toHaveBeenCalled();
  });

  it("returns 206 with byte-range headers for local downloads", async () => {
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce({
      id: "file_video",
      name: "demo.mp4",
      relativePath: "videos/demo.mp4",
      entryType: "FILE",
      mimeType: "video/mp4",
      storageNode: {
        id: "node_1",
        name: "本机存储",
        basePath: "/tmp/storage",
        driver: "LOCAL",
      },
    });

    const response = await GET(
      new Request("https://example.com/api/storage/local?path=videos%2Fdemo.mp4", {
        headers: { range: "bytes=2-5" },
      }),
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-range")).toBe("bytes 2-5/11");
    expect(response.headers.get("content-length")).toBe("4");
  });

  it("returns 416 for invalid local download ranges", async () => {
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce({
      id: "file_video",
      name: "demo.mp4",
      relativePath: "videos/demo.mp4",
      entryType: "FILE",
      mimeType: "video/mp4",
      storageNode: {
        id: "node_1",
        name: "本机存储",
        basePath: "/tmp/storage",
        driver: "LOCAL",
      },
    });

    const response = await GET(
      new Request("https://example.com/api/storage/local?path=videos%2Fdemo.mp4", {
        headers: { range: "bytes=99-100" },
      }),
    );

    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */11");
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

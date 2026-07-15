import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    listDirectory: vi.fn(),
    makeDirectory: vi.fn(),
    renameEntry: vi.fn(),
    deleteFile: vi.fn(),
    downloadFile: vi.fn(),
    uploadFile: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: mocks.requireApiPermission,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    server: { findUnique: vi.fn(async () => ({ id: "srv1", teamId: null })) },
  },
}));

vi.mock("@/lib/ssh/sftp-service", () => ({
  listDirectory: mocks.listDirectory,
  makeDirectory: mocks.makeDirectory,
  renameEntry: mocks.renameEntry,
  deleteFile: mocks.deleteFile,
  downloadFile: mocks.downloadFile,
  uploadFile: mocks.uploadFile,
  sanitizeRemotePath: (p: string) => p,
  sanitizeFileName: (n: string) => n,
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const listRoute = await import("../list/route");
const mkdirRoute = await import("../mkdir/route");
const renameRoute = await import("../rename/route");
const deleteRoute = await import("../delete/route");
const downloadRoute = await import("../download/route");

const session = { userId: "u1", username: "alice", roles: ["admin"] };

function jsonRequest(method: string, body: unknown, url = "http://local/api/servers/srv1/sftp/list") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(id = "srv1") {
  return Promise.resolve({ id });
}

describe("/api/servers/[id]/sftp/list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session });
  });

  it("returns directory entries for a valid path", async () => {
    mocks.listDirectory.mockResolvedValue([
      { name: "foo", isDirectory: true, isFile: false, isSymlink: false, size: 0, modifyTime: 1700000000, accessTime: 1700000000, owner: 0, group: 0, longname: "drwxr-xr-x foo" },
      { name: "bar.txt", isDirectory: false, isFile: true, isSymlink: false, size: 1024, modifyTime: 1700000001, accessTime: 1700000001, owner: 0, group: 0, longname: "-rw-r--r-- bar.txt" },
    ]);

    const res = await listRoute.POST(jsonRequest("POST", { path: "/root" }), { params: params() });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.path).toBe("/root");
    expect(json.entries).toHaveLength(2);
    expect(json.entries[0].name).toBe("foo");
    expect(json.entries[1].name).toBe("bar.txt");
  });

  it("returns 400 for missing path", async () => {
    const res = await listRoute.POST(jsonRequest("POST", {}), { params: params() });
    expect(res.status).toBe(400);
  });

  it("returns 500 when sftp service throws", async () => {
    mocks.listDirectory.mockRejectedValue(new Error("SSH connection failed"));
    const res = await listRoute.POST(jsonRequest("POST", { path: "/root" }), { params: params() });
    expect(res.status).toBe(500);
  });
});

describe("/api/servers/[id]/sftp/mkdir", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session });
  });

  it("creates a directory successfully", async () => {
    mocks.makeDirectory.mockResolvedValue(undefined);
    const res = await mkdirRoute.POST(
      jsonRequest("POST", { path: "/root/newdir" }, "http://local/api/servers/srv1/sftp/mkdir"),
      { params: params() },
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.path).toBe("/root/newdir");
  });

  it("returns 400 for missing path", async () => {
    const res = await mkdirRoute.POST(
      jsonRequest("POST", {}, "http://local/api/servers/srv1/sftp/mkdir"),
      { params: params() },
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/servers/[id]/sftp/rename", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session });
  });

  it("renames successfully", async () => {
    mocks.renameEntry.mockResolvedValue(undefined);
    const res = await renameRoute.POST(
      jsonRequest("POST", { oldPath: "/root/a.txt", newPath: "/root/b.txt" }, "http://local/api/servers/srv1/sftp/rename"),
      { params: params() },
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.oldPath).toBe("/root/a.txt");
    expect(json.newPath).toBe("/root/b.txt");
  });

  it("returns 400 for missing fields", async () => {
    const res = await renameRoute.POST(
      jsonRequest("POST", { oldPath: "/root/a.txt" }, "http://local/api/servers/srv1/sftp/rename"),
      { params: params() },
    );
    expect(res.status).toBe(400);
  });
});

describe("/api/servers/[id]/sftp/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session });
  });

  it("deletes a file successfully", async () => {
    mocks.deleteFile.mockResolvedValue(undefined);
    const res = await deleteRoute.DELETE(
      new Request("http://local/api/servers/srv1/sftp/delete?path=/root/old.txt", { method: "DELETE" }),
      { params: params() },
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.path).toBe("/root/old.txt");
  });
});

describe("/api/servers/[id]/sftp/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session });
  });

  it("streams a file with correct headers", async () => {
    const { Readable } = await import("node:stream");
    const mockStream = Readable.from(Buffer.from("test file content"));
    mocks.downloadFile.mockResolvedValue({ stream: mockStream, size: 17 });

    const res = await downloadRoute.GET(
      new Request("http://local/api/servers/srv1/sftp/download?path=/root/file.txt", { method: "GET" }),
      { params: params() },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toContain("file.txt");
    expect(res.headers.get("Content-Length")).toBe("17");
  });
});

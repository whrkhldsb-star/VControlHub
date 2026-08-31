import { File as NodeFile } from "node:buffer";
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
    assertSftpPathAccess: vi.fn(),
    auditUserAction: vi.fn(),
    serverFindUnique: vi.fn(
      async (): Promise<{ id: string; teamId: string | null }> => ({ id: "srv1", teamId: null }),
    ),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: mocks.requireApiPermission,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    server: { findUnique: mocks.serverFindUnique },
  },
}));

// The real path guard opens an SSH connection to canonicalise each path, and the
// real audit writer hits tables this harness does not stub.
vi.mock("@/lib/ssh/sftp-access-control", () => ({
  assertSftpPathAccess: mocks.assertSftpPathAccess,
}));

vi.mock("@/lib/audit/service", () => ({
  auditUserAction: mocks.auditUserAction,
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
const uploadRoute = await import("../upload/route");

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

/**
 * Upload is the only SFTP route that parses multipart itself, so it re-implements
 * the guard chain (rate limit → permission → team scope → size checks) by hand
 * instead of inheriting it from `withApiRoute`. These tests pin that chain, and
 * in particular that a path-ACL rejection keeps its own 403/404 status instead of
 * collapsing into a 500 the way a bare `catch` would.
 */
const UPLOAD_URL = "http://local/api/servers/srv1/sftp/upload";
const BOUNDARY = "----vchUploadBoundary";

// The route validates the multipart entry with `file instanceof File` against the
// global. Under this suite's jsdom environment that global is jsdom's File, which
// has no `.stream()`, while `request.formData()` hands back undici's File — a
// mismatch that cannot happen in the Next.js runtime, where both come from
// undici. Point the global at the parser's own class so the check means the same
// thing here as it does in production.
globalThis.File = NodeFile as unknown as typeof globalThis.File;

/**
 * Build the multipart body by hand. `new Response(formData)` never resolves
 * under jsdom, and `new Request(url, { body: formData })` omits Content-Length,
 * which this route rejects with 411 on purpose.
 */
function multipartRequest(
  fields: { file?: { name: string; content: string }; path?: string },
  overrides: { contentLength?: string | null } = {},
) {
  const parts: string[] = [];
  if (fields.file) {
    parts.push(
      `--${BOUNDARY}`,
      `Content-Disposition: form-data; name="file"; filename="${fields.file.name}"`,
      "Content-Type: application/octet-stream",
      "",
      fields.file.content,
    );
  }
  if (fields.path !== undefined) {
    parts.push(
      `--${BOUNDARY}`,
      'Content-Disposition: form-data; name="path"',
      "",
      fields.path,
    );
  }
  parts.push(`--${BOUNDARY}--`, "");
  const body = Buffer.from(parts.join("\r\n"));

  const headers = new Headers({
    "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
  });
  const declared =
    overrides.contentLength === undefined
      ? String(body.byteLength)
      : overrides.contentLength;
  if (declared !== null) headers.set("content-length", declared);

  return new Request(UPLOAD_URL, { method: "POST", headers, body });
}

describe("/api/servers/[id]/sftp/upload", () => {
  const operator = {
    userId: "u1",
    username: "alice",
    roles: ["operator"],
    currentTeamId: "team_1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks only drops recorded calls; a mockResolvedValue/mockRejectedValue
    // set inside a test is an *implementation* and survives it. Reset the two stubs
    // whose per-test values would otherwise leak (a foreign-team server, a rejecting
    // path guard) — mockReset restores the implementation given to vi.fn().
    mocks.serverFindUnique.mockReset();
    mocks.assertSftpPathAccess.mockReset();
    mocks.requireApiPermission.mockResolvedValue({ session: operator });
    mocks.serverFindUnique.mockResolvedValue({ id: "srv1", teamId: "team_1" });
    mocks.uploadFile.mockResolvedValue(7);
  });

  it("uploads the file and audits it under the caller's team", async () => {
    const res = await uploadRoute.POST(
      multipartRequest({ file: { name: "a.txt", content: "content" }, path: "/root" }),
      { params: params() },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, path: "/root/a.txt", size: 7 });
    expect(mocks.uploadFile).toHaveBeenCalledWith("srv1", "/root/a.txt", expect.anything());
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "sftp.upload",
      { serverId: "srv1", path: "/root/a.txt", size: 7 },
      undefined,
      "team_1",
    );
  });

  it("collapses a trailing slash on the target directory", async () => {
    await uploadRoute.POST(
      multipartRequest({ file: { name: "a.txt", content: "content" }, path: "/root/" }),
      { params: params() },
    );
    expect(mocks.uploadFile).toHaveBeenCalledWith("srv1", "/root/a.txt", expect.anything());
  });

  it("checks the ACL against the composed destination, not the directory", async () => {
    await uploadRoute.POST(
      multipartRequest({ file: { name: "a.txt", content: "content" }, path: "/root/sub" }),
      { params: params() },
    );
    expect(mocks.assertSftpPathAccess).toHaveBeenCalledWith({
      session: operator,
      serverId: "srv1",
      paths: ["/root/sub/a.txt"],
    });
  });

  it("404s a server outside the caller's team without touching the filesystem", async () => {
    mocks.serverFindUnique.mockResolvedValue({ id: "srv1", teamId: "team_other" });

    const res = await uploadRoute.POST(
      multipartRequest({ file: { name: "a.txt", content: "content" }, path: "/root" }),
      { params: params() },
    );

    expect(res.status).toBe(404);
    expect(mocks.assertSftpPathAccess).not.toHaveBeenCalled();
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("rejects a body whose declared length exceeds the cap before parsing it", async () => {
    const res = await uploadRoute.POST(
      multipartRequest(
        { file: { name: "a.txt", content: "content" }, path: "/root" },
        { contentLength: String(200 * 1024 * 1024) },
      ),
      { params: params() },
    );
    const json = await res.json();

    expect(res.status).toBe(413);
    expect(json.code).toBe("REQUEST_ENTITY_TOO_LARGE");
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("rejects a body with no declared length", async () => {
    const res = await uploadRoute.POST(
      multipartRequest(
        { file: { name: "a.txt", content: "content" }, path: "/root" },
        { contentLength: null },
      ),
      { params: params() },
    );
    const json = await res.json();

    expect(res.status).toBe(411);
    expect(json.code).toBe("BAD_REQUEST");
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it.each([
    ["file", { path: "/root" }],
    ["path", { file: { name: "a.txt", content: "content" } }],
  ])("400s when the %s field is missing", async (_field, fields) => {
    const res = await uploadRoute.POST(multipartRequest(fields), { params: params() });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe("MISSING_FIELD");
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("keeps a path-ACL rejection as 403 instead of a 500", async () => {
    const { ForbiddenError } = await import("@/lib/errors");
    mocks.assertSftpPathAccess.mockRejectedValue(new ForbiddenError("outside home"));

    const res = await uploadRoute.POST(
      multipartRequest({ file: { name: "a.txt", content: "content" }, path: "/etc" }),
      { params: params() },
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.message).toBe("outside home");
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("keeps a disabled-server rejection as 404 instead of a 500", async () => {
    const { NotFoundError } = await import("@/lib/errors");
    mocks.assertSftpPathAccess.mockRejectedValue(new NotFoundError("server disabled"));

    const res = await uploadRoute.POST(
      multipartRequest({ file: { name: "a.txt", content: "content" }, path: "/root" }),
      { params: params() },
    );

    expect(res.status).toBe(404);
    expect(mocks.uploadFile).not.toHaveBeenCalled();
  });

  it("masks an unexpected transfer failure as a generic 500", async () => {
    mocks.uploadFile.mockRejectedValue(new Error("ssh2: EHOSTUNREACH 10.0.0.7:22"));

    const res = await uploadRoute.POST(
      multipartRequest({ file: { name: "a.txt", content: "content" }, path: "/root" }),
      { params: params() },
    );
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.code).toBe("INTERNAL_ERROR");
    expect(json.message).toBe("Upload failed");
    expect(mocks.auditUserAction).not.toHaveBeenCalled();
  });
});

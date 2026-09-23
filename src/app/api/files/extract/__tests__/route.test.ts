import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireApiPermissionMock,
  assertStorageAccessMock,
  prismaMock,
  createFileEntryMock,
} = vi.hoisted(() => ({
  requireApiPermissionMock: vi.fn(),
  assertStorageAccessMock: vi.fn(),
  prismaMock: {
    storageNode: { findFirst: vi.fn() },
    fileEntry: { findFirst: vi.fn() },
  },
  createFileEntryMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: assertStorageAccessMock,
  releaseStorageQuotaGuard: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/storage/service", () => ({
  createFileEntry: createFileEntryMock,
}));
vi.mock("@/lib/http/rate-limit-presets", () => ({
  GENERAL_WRITE_LIMIT: { windowMs: 1, max: 5 },
  withRateLimit: () => ({ allowed: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));

import { POST } from "../route";

let tempDir: string;

async function createTarGz() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "vch-extract-"));
  await writeFile(path.join(tempDir, "hello.txt"), "hello");
  const archivePath = path.join(tempDir, "backup.tar.gz");
  const { execFile } = await import("node:child_process");
  const { resolveLocalTarBinary } = await import("@/lib/runtime/tar-binary");
  await new Promise<void>((resolve, reject) => {
    execFile(
      resolveLocalTarBinary(),
      ["-czf", archivePath, "-C", tempDir, "hello.txt"],
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

async function createGz() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "vch-extract-gz-"));
  // Build the fixture with zlib so the test does not depend on a gzip binary.
  await writeFile(
    path.join(tempDir, "notes.txt.gz"),
    gzipSync(Buffer.from("hello gzip", "utf8")),
  );
}

describe("POST /api/files/extract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValue({
      session: { userId: "u_1", username: "admin", roles: ["admin"] },
    });
    assertStorageAccessMock.mockResolvedValue({ allowed: true });
    prismaMock.fileEntry.findFirst.mockResolvedValue(null);
    createFileEntryMock.mockResolvedValue({ id: "entry_1" });
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = "";
  });

  it("recognizes .tar.gz archives and returns the tar safety message", async () => {
    await createTarGz();
    prismaMock.storageNode.findFirst.mockResolvedValue({
      id: "node_1",
      name: "local",
      driver: "LOCAL",
      basePath: tempDir,
    });

    const response = await POST(
      new NextRequest("https://app.example.test/api/files/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          serverId: "node_1",
          remotePath: "backup.tar.gz",
          driver: "LOCAL",
          name: "backup.tar.gz",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(assertStorageAccessMock).toHaveBeenCalledWith({
      session: { userId: "u_1", username: "admin", roles: ["admin"] },
      storageNodeId: "node_1",
      relativePath: "backup.tar.gz",
      operation: "read",
    });
    expect(assertStorageAccessMock).toHaveBeenCalledWith({
      session: { userId: "u_1", username: "admin", roles: ["admin"] },
      storageNodeId: "node_1",
      relativePath: ".",
      operation: "write",
    });
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("not supported"),
    });
  });

  it("rejects an SFTP node even when the client claims it is local", async () => {
    prismaMock.storageNode.findFirst.mockResolvedValue({
      id: "node_sftp",
      name: "remote",
      driver: "SFTP",
      basePath: "/",
    });

    const response = await POST(
      new NextRequest("https://app.example.test/api/files/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          storageNodeId: "node_sftp",
          relativePath: "etc/passwd",
          driver: "LOCAL",
          name: "passwd.gz",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Only local storage node archive extraction is supported",
    });
    expect(assertStorageAccessMock).not.toHaveBeenCalled();
    expect(createFileEntryMock).not.toHaveBeenCalled();
  });

  it("indexes the extracted .gz output after the real file is created", async () => {
    await createGz();
    prismaMock.storageNode.findFirst.mockResolvedValue({
      id: "node_1",
      name: "local",
      driver: "LOCAL",
      basePath: tempDir,
    });

    const response = await POST(
      new NextRequest("https://app.example.test/api/files/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          storageNodeId: "node_1",
          remotePath: "notes.txt.gz",
          driver: "LOCAL",
          name: "notes.txt.gz",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(createFileEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        storageNodeId: "node_1",
        name: "notes.txt",
        entryType: "FILE",
        relativePath: "notes.txt",
        size: 10,
      }),
    );
  });

  it("refuses .gz extraction when the output path already has an active index", async () => {
    await createGz();
    prismaMock.storageNode.findFirst.mockResolvedValue({
      id: "node_1",
      name: "local",
      driver: "LOCAL",
      basePath: tempDir,
    });
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce({ id: "existing" });

    const response = await POST(
      new NextRequest("https://app.example.test/api/files/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          storageNodeId: "node_1",
          remotePath: "notes.txt.gz",
          driver: "LOCAL",
          name: "notes.txt.gz",
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Target file /notes.txt already exists",
    });
    expect(createFileEntryMock).not.toHaveBeenCalled();
  });

  it("rejects extraction when the caller can read the archive but cannot write the target directory", async () => {
    await createGz();
    prismaMock.storageNode.findFirst.mockResolvedValue({
      id: "node_1",
      name: "local",
      driver: "LOCAL",
      basePath: tempDir,
    });
    assertStorageAccessMock
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({
        allowed: false,
        reason: "no_access",
      });

    const response = await POST(
      new NextRequest("https://app.example.test/api/files/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          storageNodeId: "node_1",
          remotePath: "notes.txt.gz",
          driver: "LOCAL",
          name: "notes.txt.gz",
        }),
      }),
    );

    expect(response.status).toBe(403);
    // Denials surface the localized copy for the reason code, not the raw
    // reason string.
    await expect(response.json()).resolves.toMatchObject({
      error: expect.any(String),
    });
    expect(createFileEntryMock).not.toHaveBeenCalled();
  });

  it("cleans up the extracted .gz output when indexing fails", async () => {
    await createGz();
    prismaMock.storageNode.findFirst.mockResolvedValue({
      id: "node_1",
      name: "local",
      driver: "LOCAL",
      basePath: tempDir,
    });
    createFileEntryMock.mockRejectedValueOnce(new Error("索引写入失败"));

    const response = await POST(
      new NextRequest("https://app.example.test/api/files/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          storageNodeId: "node_1",
          remotePath: "notes.txt.gz",
          driver: "LOCAL",
          name: "notes.txt.gz",
        }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("索引写入失败"),
    });
    await expect(
      import("node:fs/promises").then((fs) =>
        fs.access(path.join(tempDir, "notes.txt")),
      ),
    ).rejects.toThrow();
  });

  it("destroys the pipeline with a typed 413 once decompressed output crosses the cap", async () => {
    const { GunzipOutputLimiter, MAX_GUNZIP_OUTPUT_BYTES } = await import("@/lib/storage/gunzip-limiter");
    expect(MAX_GUNZIP_OUTPUT_BYTES).toBe(1024 * 1024 * 1024);

    // The route wires this Transform between gunzip and the output file; a
    // 1 GiB budget cannot be exercised end-to-end in a unit test, so drive
    // the limiter directly with a tiny budget and assert the fail semantics.
    const passed: Buffer[] = [];
    const failure = new Promise<unknown>((resolve) => {
      const limiter = new GunzipOutputLimiter(1024, "解压输出过大");
      limiter.on("data", (chunk: Buffer) => passed.push(chunk));
      limiter.on("error", resolve);
      limiter.write(Buffer.alloc(512));
      limiter.write(Buffer.alloc(512));
      limiter.write(Buffer.alloc(512));
      limiter.end();
    });
    const error = await failure;
    expect(error).toBeInstanceOf(Error);
    expect((error as { status?: number }).status).toBe(413);
    expect((error as { message?: string }).message).toBe("解压输出过大");
    // The first 1024 bytes flowed before the third write crossed the cap.
    expect(passed.reduce((total, chunk) => total + chunk.length, 0)).toBe(1024);
  });
});

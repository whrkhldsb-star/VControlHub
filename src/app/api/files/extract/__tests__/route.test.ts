import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
    storageNode: { findUnique: vi.fn() },
    fileEntry: { findFirst: vi.fn() },
  },
  createFileEntryMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: assertStorageAccessMock,
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
  await new Promise<void>((resolve, reject) => {
    execFile(
      "tar",
      ["-czf", archivePath, "-C", tempDir, "hello.txt"],
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

async function createGz() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "vch-extract-gz-"));
  const sourcePath = path.join(tempDir, "notes.txt");
  await writeFile(sourcePath, "hello gzip");
  const { execFile } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    execFile("gzip", ["-k", sourcePath], (error) =>
      error ? reject(error) : resolve(),
    );
  });
  await rm(sourcePath, { force: true });
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
    prismaMock.storageNode.findUnique.mockResolvedValue({
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

  it("indexes the extracted .gz output after the real file is created", async () => {
    await createGz();
    prismaMock.storageNode.findUnique.mockResolvedValue({
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
    prismaMock.storageNode.findUnique.mockResolvedValue({
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
    prismaMock.storageNode.findUnique.mockResolvedValue({
      id: "node_1",
      name: "local",
      driver: "LOCAL",
      basePath: tempDir,
    });
    assertStorageAccessMock
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({
        allowed: false,
        reason: "没有目标目录写入授权",
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
    await expect(response.json()).resolves.toMatchObject({
      error: "没有目标目录写入授权",
    });
    expect(createFileEntryMock).not.toHaveBeenCalled();
  });

  it("cleans up the extracted .gz output when indexing fails", async () => {
    await createGz();
    prismaMock.storageNode.findUnique.mockResolvedValue({
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
});

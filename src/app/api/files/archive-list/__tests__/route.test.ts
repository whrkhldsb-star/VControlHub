import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiPermissionMock, assertStorageAccessMock, listExternalArchiveMock, prismaMock } =
  vi.hoisted(() => ({
    requireApiPermissionMock: vi.fn(),
    assertStorageAccessMock: vi.fn(),
    listExternalArchiveMock: vi.fn(),
    prismaMock: { storageNode: { findFirst: vi.fn() }, fileEntry: { findMany: vi.fn() } },
  }));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: assertStorageAccessMock,
  releaseStorageQuotaGuard: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
// The 7z / unrar listing itself is tested with the real tools in src/lib/storage/__tests__/archive-external-list.test.ts.
vi.mock("@/lib/storage/archive-external-list", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/archive-external-list")>()),
  listExternalArchive: listExternalArchiveMock,
}));

import { zipFixture } from "@/lib/storage/__tests__/archive-fixtures";
import { ExternalArchiveError } from "@/lib/storage/archive-external-list";
import { GET } from "../route";

let tempDir: string;

async function createTarGz() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "vch-archive-list-"));
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
  return archivePath;
}

describe("GET /api/files/archive-list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValue({
      session: { userId: "u_1", username: "admin", roles: ["admin"] },
    });
    assertStorageAccessMock.mockResolvedValue({ allowed: true });
    prismaMock.fileEntry.findMany.mockResolvedValue([]);
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = "";
  });

  it("lists .tar.gz archives before falling back to plain .gz handling", async () => {
    await createTarGz();
    prismaMock.storageNode.findFirst.mockResolvedValue({
      id: "node_1",
      name: "local",
      driver: "LOCAL",
      basePath: tempDir,
    });

    const response = await GET(
      new NextRequest(
        `https://app.example.test/api/files/archive-list?nodeId=node_1&driver=LOCAL&relativePath=${encodeURIComponent("backup.tar.gz")}&name=backup.tar.gz`,
      ),
    );

    expect(response.status).toBe(200);
    expect(assertStorageAccessMock).toHaveBeenCalledWith({
      session: { userId: "u_1", username: "admin", roles: ["admin"] },
      storageNodeId: "node_1",
      relativePath: "backup.tar.gz",
      operation: "read",
    });
    await expect(response.json()).resolves.toMatchObject({
      entries: [
        expect.objectContaining({ name: "hello.txt", isDirectory: false }),
      ],
    });
  });

  it("does not list an archive that is in the recycle bin (404 as if it were gone)", async () => {
    // Deleting only marks the index; the bytes stay on disk and used to be listed like any other archive.
    await createTarGz();
    prismaMock.storageNode.findFirst.mockResolvedValue({ id: "node_1", name: "local", driver: "LOCAL", basePath: tempDir });
    prismaMock.fileEntry.findMany.mockResolvedValue([{ relativePath: "backup.tar.gz" }]);

    const response = await GET(
      new NextRequest(`https://app.example.test/api/files/archive-list?nodeId=node_1&driver=LOCAL&relativePath=backup.tar.gz&name=backup.tar.gz`),
    );

    expect(response.status).toBe(404);
  });

  it("lists a ZIP's contents (unzip -l on Ubuntu printed dates the parser skipped, so every ZIP looked empty)", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "vch-archive-list-zip-"));
    await writeFile(path.join(tempDir, "release.zip"), zipFixture([
      { name: "release/", directory: true },
      { name: "release/程序.exe", data: "MZ", deflate: true },
    ]));
    prismaMock.storageNode.findFirst.mockResolvedValue({ id: "node_1", name: "local", driver: "LOCAL", basePath: tempDir });

    const response = await GET(
      new NextRequest(`https://app.example.test/api/files/archive-list?nodeId=node_1&driver=LOCAL&relativePath=release.zip&name=release.zip`),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      entries: [
        expect.objectContaining({ name: "release", isDirectory: true }),
        expect.objectContaining({ name: "release/程序.exe", size: 2, isDirectory: false }),
      ],
    });
  });

  it("says a damaged ZIP is damaged instead of failing with a server error", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "vch-archive-list-bad-"));
    await writeFile(path.join(tempDir, "bad.zip"), "plain text");
    prismaMock.storageNode.findFirst.mockResolvedValue({ id: "node_1", name: "local", driver: "LOCAL", basePath: tempDir });

    const response = await GET(
      new NextRequest(`https://app.example.test/api/files/archive-list?nodeId=node_1&driver=LOCAL&relativePath=bad.zip&name=bad.zip`),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/damaged|损坏/) });
  });

  it("lists .7z and .rar archives through the server's tool and keeps unsafe members out", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "vch-archive-list-ext-"));
    prismaMock.storageNode.findFirst.mockResolvedValue({ id: "node_1", name: "local", driver: "LOCAL", basePath: tempDir });
    for (const [file, kind] of [["photos.7z", "7z"], ["photos.RAR", "rar"]] as const) {
      await writeFile(path.join(tempDir, file), "archive bytes");
      listExternalArchiveMock.mockResolvedValueOnce([
        { name: "photos", size: 0, isDirectory: true },
        { name: "photos/夏天.jpg", size: 2048, isDirectory: false },
        { name: "../outside.txt", size: 1, isDirectory: false },
      ]);

      const response = await GET(new NextRequest(`https://app.example.test/api/files/archive-list?nodeId=node_1&relativePath=${file}&name=${file}`));

      expect(response.status).toBe(200);
      expect((await response.json()).entries.map((entry: { name: string }) => entry.name)).toEqual(["photos", "photos/夏天.jpg"]);
      expect(listExternalArchiveMock).toHaveBeenLastCalledWith(kind, path.join(tempDir, file));
    }
  });

  it("says in words why a .7z or .rar archive cannot be listed", async () => {
    // Every failure — no tool, an encrypted file list, a damaged file — was a 500 that named a missing tool.
    tempDir = await mkdtemp(path.join(os.tmpdir(), "vch-archive-list-ext-"));
    await writeFile(path.join(tempDir, "a.7z"), "archive bytes");
    await writeFile(path.join(tempDir, "a.rar"), "archive bytes");
    prismaMock.storageNode.findFirst.mockResolvedValue({ id: "node_1", name: "local", driver: "LOCAL", basePath: tempDir });
    const ask = async (file: string, error: ExternalArchiveError) => {
      listExternalArchiveMock.mockRejectedValueOnce(error);
      const response = await GET(new NextRequest(`https://app.example.test/api/files/archive-list?nodeId=node_1&relativePath=${file}&name=${file}`));
      expect(response.status).toBe(400);
      return (await response.json()).error as string;
    };

    expect(await ask("a.rar", new ExternalArchiveError("toolMissing", "rar", "unrar"))).toBe("This server has no unrar command, so the contents of .rar archives cannot be shown");
    expect(await ask("a.7z", new ExternalArchiveError("passwordProtected", "7z"))).toMatch(/protected by a password/);
    expect(await ask("a.7z", new ExternalArchiveError("unreadable", "7z", "Is not archive"))).toMatch(/damaged/);
    expect(await ask("a.7z", new ExternalArchiveError("listingTooLarge", "7z"))).toMatch(/too many entries/);
  });

  it("rejects archive listing outside the caller storage grant", async () => {
    await createTarGz();
    assertStorageAccessMock.mockResolvedValueOnce({
      allowed: false,
      reason: "no_access",
    });
    prismaMock.storageNode.findFirst.mockResolvedValue({
      id: "node_1",
      name: "local",
      driver: "LOCAL",
      basePath: tempDir,
    });

    const response = await GET(
      new NextRequest(
        `https://app.example.test/api/files/archive-list?nodeId=node_1&driver=LOCAL&relativePath=${encodeURIComponent("backup.tar.gz")}&name=backup.tar.gz`,
      ),
    );

    expect(response.status).toBe(403);
    // Denials surface the localized copy for the reason code, not the raw
    // reason string.
    await expect(response.json()).resolves.toMatchObject({
      error: expect.any(String),
    });
  });

  it("rejects missing nodeId with validation error", async () => {
    const response = await GET(
      new NextRequest(
        `https://app.example.test/api/files/archive-list?driver=LOCAL&relativePath=${encodeURIComponent("backup.tar.gz")}`,
      ),
    );

    expect(response.status).toBe(400);
    expect(prismaMock.storageNode.findFirst).not.toHaveBeenCalled();
  });

  it("rejects an SFTP node even when the client claims it is local", async () => {
    prismaMock.storageNode.findFirst.mockResolvedValue({
      id: "node_sftp",
      name: "remote",
      driver: "SFTP",
      basePath: "/",
    });

    const response = await GET(
      new NextRequest(
        "https://app.example.test/api/files/archive-list?nodeId=node_sftp&driver=LOCAL&relativePath=etc%2Fpasswd&name=passwd",
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Only local storage node archive viewing is supported",
    });
    expect(assertStorageAccessMock).not.toHaveBeenCalled();
  });

  it("detects archive format from relativePath even when name is generic", async () => {
    await createTarGz();
    prismaMock.storageNode.findFirst.mockResolvedValue({
      id: "node_1",
      name: "local",
      driver: "LOCAL",
      basePath: tempDir,
    });

    const response = await GET(
      new NextRequest(
        `https://app.example.test/api/files/archive-list?nodeId=node_1&driver=LOCAL&relativePath=${encodeURIComponent("backup.tar.gz")}&name=archive`,
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      entries: [
        expect.objectContaining({ name: "hello.txt", isDirectory: false }),
      ],
    });
  });
});

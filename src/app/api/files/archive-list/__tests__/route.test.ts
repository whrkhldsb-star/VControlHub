import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiPermissionMock, assertStorageAccessMock, prismaMock } =
  vi.hoisted(() => ({
    requireApiPermissionMock: vi.fn(),
    assertStorageAccessMock: vi.fn(),
    prismaMock: { storageNode: { findFirst: vi.fn() } },
  }));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: assertStorageAccessMock,
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { GET } from "../route";

let tempDir: string;

async function createTarGz() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "vch-archive-list-"));
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
  return archivePath;
}

describe("GET /api/files/archive-list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValue({
      session: { userId: "u_1", username: "admin", roles: ["admin"] },
    });
    assertStorageAccessMock.mockResolvedValue({ allowed: true });
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

  it("rejects archive listing outside the caller storage grant", async () => {
    await createTarGz();
    assertStorageAccessMock.mockResolvedValueOnce({
      allowed: false,
      reason: "没有该存储节点或路径的访问授权",
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
    await expect(response.json()).resolves.toMatchObject({
      error: "没有该存储节点或路径的访问授权",
    });
  });
});

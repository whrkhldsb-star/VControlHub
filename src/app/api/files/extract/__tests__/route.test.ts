import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiPermissionMock, assertStorageAccessMock, prismaMock } =
  vi.hoisted(() => ({
    requireApiPermissionMock: vi.fn(),
    assertStorageAccessMock: vi.fn(),
    prismaMock: { storageNode: { findUnique: vi.fn() } },
  }));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: assertStorageAccessMock,
}));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
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

describe("POST /api/files/extract", () => {
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
      operation: "write",
    });
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("暂不支持在线解压 tar/tgz"),
    });
  });

  it("rejects archives outside the caller storage grant before extracting", async () => {
    await createTarGz();
    assertStorageAccessMock.mockResolvedValueOnce({
      allowed: false,
      reason: "没有该存储节点或路径的访问授权",
    });
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
          remotePath: "backup.tar.gz",
          driver: "LOCAL",
          name: "backup.tar.gz",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "没有该存储节点或路径的访问授权",
    });
  });
});

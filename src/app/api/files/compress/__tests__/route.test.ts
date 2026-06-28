import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
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

let tempDir = "";
const session = { userId: "u_1", username: "admin", roles: ["admin"] };

async function setupLocalNode() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "vch-compress-"));
  await mkdir(path.join(tempDir, "docs"), { recursive: true });
  await writeFile(path.join(tempDir, "docs", "a.txt"), "alpha");
  await writeFile(path.join(tempDir, "docs", "b.txt"), "beta");
  prismaMock.storageNode.findUnique.mockResolvedValue({
    id: "node_1",
    driver: "LOCAL",
    basePath: tempDir,
  });
}

function request(body: unknown) {
  return POST(
    new NextRequest("https://app.example.test/api/files/compress", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/files/compress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValue({ session });
    assertStorageAccessMock.mockResolvedValue({ allowed: true });
    prismaMock.fileEntry.findFirst.mockResolvedValue(null);
    createFileEntryMock.mockResolvedValue({ id: "entry_1" });
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = "";
  });

  it("creates a tar.gz archive from selected local files and indexes it", async () => {
    await setupLocalNode();

    const response = await request({
      storageNodeId: "node_1",
      relativePaths: ["docs/a.txt", "docs/b.txt"],
      targetDir: "docs",
      outputName: "selected",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      name: "selected.tar.gz",
      relativePath: "docs/selected.tar.gz",
    });
    expect(createFileEntryMock).toHaveBeenCalledWith(expect.objectContaining({
      storageNodeId: "node_1",
      name: "selected.tar.gz",
      entryType: "FILE",
      mimeType: "application/gzip",
      relativePath: "docs/selected.tar.gz",
    }));

    const archivePath = path.join(tempDir, "docs", "selected.tar.gz");
    await new Promise<void>((resolve, reject) => {
      execFile("tar", ["-tzf", archivePath], (error, stdout) => {
        if (error) return reject(error);
        expect(stdout).toContain("docs/a.txt");
        expect(stdout).toContain("docs/b.txt");
        resolve();
      });
    });
  });

  it("rejects when output archive already exists", async () => {
    await setupLocalNode();
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce({ id: "existing" });

    const response = await request({
      storageNodeId: "node_1",
      relativePaths: ["docs/a.txt"],
      targetDir: "docs",
      outputName: "selected.tar.gz",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "目标压缩包 /docs/selected.tar.gz 已存在",
    });
    expect(createFileEntryMock).not.toHaveBeenCalled();
  });

  it("checks write access before read access", async () => {
    await setupLocalNode();
    assertStorageAccessMock.mockResolvedValueOnce({ allowed: false, reason: "没有目标目录写入授权" });

    const response = await request({
      storageNodeId: "node_1",
      relativePaths: ["docs/a.txt"],
      targetDir: "docs",
      outputName: "selected",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "没有目标目录写入授权" });
    expect(assertStorageAccessMock).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe output names", async () => {
    await setupLocalNode();

    const response = await request({
      storageNodeId: "node_1",
      relativePaths: ["docs/a.txt"],
      outputName: "../escape.tar.gz",
    });

    expect(response.status).toBe(400);
    expect(createFileEntryMock).not.toHaveBeenCalled();
  });
});

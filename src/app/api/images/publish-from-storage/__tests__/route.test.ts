import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireApiPermissionMock,
  assertStorageAccessMock,
  imageCreateMock,
  imageFindFirstMock,
  storageFindUniqueMock,
} = vi.hoisted(() => ({
  requireApiPermissionMock: vi.fn(),
  assertStorageAccessMock: vi.fn(),
  imageCreateMock: vi.fn(),
  imageFindFirstMock: vi.fn(),
  storageFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: assertStorageAccessMock,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    imageUpload: {
      create: imageCreateMock,
      findFirst: imageFindFirstMock,
    },
    storageNode: {
      findUnique: storageFindUniqueMock,
    },
  },
}));
vi.mock("@/lib/image-bed/constants", () => ({
  IMAGE_EXTENSIONS: new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"]),
  UPLOAD_DIR: "/tmp/vcontrolhub-image-publish-test",
  mimeTypeFromExt: (ext: string) => ext === ".png" ? "image/png" : "image/jpeg",
}));

import { POST } from "../route";

const uploadRoot = "/tmp/vcontrolhub-image-publish-test";
const storageRoot = "/tmp/vcontrolhub-image-publish-storage";
const session = { userId: "u_1", username: "alice", roles: ["operator"] };

function publishRequest(body?: Record<string, unknown>) {
  return new Request("https://example.com/api/images/publish-from-storage", {
    method: "POST",
    body: JSON.stringify({
      storageNodeId: "node_1",
      relativePath: "gallery/source.png",
      ...body,
    }),
  });
}

async function listFiles(root: string) {
  try {
    return await readdir(root);
  } catch {
    return [];
  }
}

describe("POST /api/images/publish-from-storage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await rm(uploadRoot, { recursive: true, force: true });
    await rm(storageRoot, { recursive: true, force: true });
    await mkdir(path.join(storageRoot, "gallery"), { recursive: true });
    await writeFile(path.join(storageRoot, "gallery", "source.png"), Buffer.from("png"));
    requireApiPermissionMock.mockResolvedValue({ session });
    assertStorageAccessMock.mockResolvedValue({ allowed: true });
    storageFindUniqueMock.mockResolvedValue({ id: "node_1", driver: "LOCAL", basePath: storageRoot });
    imageFindFirstMock.mockResolvedValue(null);
    imageCreateMock.mockResolvedValue({ id: "img_1", filename: "source.png" });
  });

  afterEach(async () => {
    await rm(uploadRoot, { recursive: true, force: true });
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("authorizes the exact source storage path before publishing it as a public image", async () => {
    const response = await POST(publishRequest());

    expect(response.status).toBe(201);
    expect(requireApiPermissionMock).toHaveBeenCalledWith("storage:read");
    expect(assertStorageAccessMock).toHaveBeenCalledWith({
      session,
      storageNodeId: "node_1",
      relativePath: "gallery/source.png",
      operation: "read",
    });
    expect(imageCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        storageNodeId: "node_1",
        relativePath: "gallery/source.png",
        userId: "u_1",
      }),
    }));
    const publishedFile = (await listFiles(uploadRoot))[0];
    expect(publishedFile).toMatch(/\.png$/);
    await expect(readFile(path.join(uploadRoot, publishedFile!))).resolves.toEqual(Buffer.from("png"));
  });

  it("rejects inaccessible source paths before reading or writing public image files", async () => {
    assertStorageAccessMock.mockResolvedValueOnce({ allowed: false, reason: "没有该存储节点或路径的访问授权" });

    const response = await POST(publishRequest());

    expect(response.status).toBe(403);
    expect(await listFiles(uploadRoot)).toEqual([]);
    expect(imageFindFirstMock).not.toHaveBeenCalled();
    expect(imageCreateMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: "没有该存储节点或路径的访问授权",
    });
  });

  it("removes the written public image file when image record creation fails", async () => {
    imageCreateMock.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await POST(publishRequest());

    expect(response.status).toBe(500);
    expect(await listFiles(uploadRoot)).toEqual([]);
  });
});

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
// Six requests in one file: keep the 5-per-minute upload limit out of the way.
vi.mock("@/lib/http/rate-limit-presets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/http/rate-limit-presets")>()),
  IMAGE_UPLOAD_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
}));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: assertStorageAccessMock,
  releaseStorageQuotaGuard: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    imageUpload: {
      create: imageCreateMock,
      findFirst: imageFindFirstMock,
    },
    storageNode: {
      findFirst: storageFindUniqueMock,
    },
  },
}));
vi.mock("@/lib/image-bed/constants", () => ({
  UPLOAD_DIR: "/tmp/vcontrolhub-image-publish-test",
  mimeTypeFromExt: (ext: string) => ext === ".png" ? "image/png" : "image/jpeg",
}));
vi.mock("@/lib/image/service", () => ({
  extractMetadata: vi.fn(async () => ({ width: 2, height: 2, format: "png", sizeBytes: 3 })),
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
  it("needs the image-bed write permission, not only storage read", async () => {
    // A read-only role (viewer: storage:read, no image:write) could add images.
    requireApiPermissionMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }));
    const response = await POST(publishRequest());
    expect(requireApiPermissionMock).toHaveBeenCalledWith("image:write");
    expect(response.status).toBe(403);
    expect(imageCreateMock).not.toHaveBeenCalled();
  });

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
    expect(requireApiPermissionMock).toHaveBeenCalledWith("image:write");
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

  it("rejects SVG storage files before they can be published inline", async () => {
    const response = await POST(publishRequest({ relativePath: "gallery/attack.svg" }));

    expect(response.status).toBe(400);
    expect(assertStorageAccessMock).not.toHaveBeenCalled();
    expect(imageCreateMock).not.toHaveBeenCalled();
  });

  it("removes the written public image file when image record creation fails", async () => {
    imageCreateMock.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await POST(publishRequest());

    expect(response.status).toBe(500);
    expect(await listFiles(uploadRoot)).toEqual([]);
  });

  it("returns 404 when storage node is outside team scope", async () => {
    storageFindUniqueMock.mockResolvedValueOnce(null);
    const response = await POST(publishRequest());
    expect(response.status).toBe(404);
    expect(assertStorageAccessMock).not.toHaveBeenCalled();
    expect(imageCreateMock).not.toHaveBeenCalled();
  });

  it("looks for a duplicate among the caller's own and the public images of the customer only", async () => {
    // A private image of another member matched by checksum came back as the "existing" one, row and all.
    requireApiPermissionMock.mockResolvedValueOnce({ session: { ...session, currentTeamId: "team_1" } });
    const response = await POST(publishRequest());
    expect(response.status).toBe(201);
    expect(imageFindFirstMock).toHaveBeenCalledWith({
      where: { checksum: expect.any(String), teamId: "team_1", OR: [{ userId: "u_1" }, { isPublic: true }] },
    });
  });
});

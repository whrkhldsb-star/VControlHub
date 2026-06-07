import { describe, expect, it, vi } from "vitest";

const {
  requireApiSessionMock,
  sessionHasPermissionMock,
  imageFindManyMock,
  imageDeleteManyMock,
  imageUpdateManyMock,
  imageUpdateMock,
  unlinkMock,
} = vi.hoisted(() => ({
  requireApiSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  imageFindManyMock: vi.fn(),
  imageDeleteManyMock: vi.fn(),
  imageUpdateManyMock: vi.fn(),
  imageUpdateMock: vi.fn(),
  unlinkMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: requireApiSessionMock,
}));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: sessionHasPermissionMock,
}));
vi.mock("node:fs/promises", () => ({
  default: { mkdir: vi.fn(), writeFile: vi.fn(), unlink: unlinkMock },
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  unlink: unlinkMock,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    imageUpload: {
      findMany: imageFindManyMock,
      deleteMany: imageDeleteManyMock,
      updateMany: imageUpdateManyMock,
      update: imageUpdateMock,
    },
  },
}));
vi.mock("@/lib/image-bed/constants", () => ({
  UPLOAD_DIR: "/tmp/vcontrolhub-image-batch-test",
}));
vi.mock("@/lib/http/rate-limit-presets", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http/rate-limit-presets")>("@/lib/http/rate-limit-presets");
  return { ...actual, withRateLimit: vi.fn().mockResolvedValue({ allowed: true }) };
});

import { POST } from "../route";

const ownerSession = { userId: "u_1", username: "alice" };
const managerSession = { userId: "u_manager", username: "manager" };
const viewerSession = { userId: "u_viewer", username: "viewer" };

async function postBatch(body: unknown) {
  return POST(
    new Request("https://example.com/api/images/batch", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

describe("/api/images/batch", () => {
  it("keeps regular users scoped to their own images for non-destructive batch updates", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(ownerSession);
    sessionHasPermissionMock.mockReturnValue(false);
    imageUpdateManyMock.mockResolvedValueOnce({ count: 1 });

    const response = await postBatch({
      action: "moveAlbum",
      ids: ["img_1", "img_2"],
      album: "personal",
    });

    expect(response.status).toBe(200);
    expect(imageUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["img_1", "img_2"] }, userId: "u_1" },
      data: { album: "personal" },
    });
  });

  it("does not let user:read viewers batch-delete other users' images", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(viewerSession);
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) => permission === "user:read",
    );

    const response = await postBatch({ action: "delete", ids: ["img_2"] });

    expect(response.status).toBe(403);
    expect(imageFindManyMock).not.toHaveBeenCalled();
    expect(imageDeleteManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: "无权批量删除图片" });
  });

  it("allows storage delete managers to batch-delete selected images across owners", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(managerSession);
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) => permission === "storage:delete",
    );
    imageFindManyMock.mockResolvedValueOnce([
      { id: "img_2", storageKey: "albums/remote.png" },
    ]);
    imageDeleteManyMock.mockResolvedValueOnce({ count: 1 });
    unlinkMock.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    const response = await postBatch({ action: "delete", ids: ["img_2"] });

    expect(response.status).toBe(200);
    expect(imageFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["img_2"] } },
      select: { id: true, storageKey: true },
      take: 100,
    });
    expect(imageDeleteManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["img_2"] } },
    });
    expect(unlinkMock).toHaveBeenCalledWith(
      "/tmp/vcontrolhub-image-batch-test/albums/remote.png",
    );
    expect(unlinkMock).toHaveBeenCalledWith(
      "/tmp/vcontrolhub-image-batch-test/albums/remote_thumb.webp",
    );
    await expect(response.json()).resolves.toEqual({ deleted: 1 });
  });
});

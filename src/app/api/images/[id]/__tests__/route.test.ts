import { describe, expect, it, vi } from "vitest";

const {
  requireApiSessionMock,
  sessionHasPermissionMock,
  imageFindUniqueMock,
  imageDeleteMock,
  storageFindUniqueMock,
  unlinkMock,
} = vi.hoisted(() => ({
  requireApiSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  imageFindUniqueMock: vi.fn(),
  imageDeleteMock: vi.fn(),
  storageFindUniqueMock: vi.fn(),
  unlinkMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: requireApiSessionMock,
}));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: sessionHasPermissionMock,
}));
vi.mock("node:fs/promises", () => ({
  default: { unlink: unlinkMock },
  unlink: unlinkMock,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    imageUpload: {
      findUnique: imageFindUniqueMock,
      delete: imageDeleteMock,
    },
    storageNode: {
      findUnique: storageFindUniqueMock,
    },
  },
}));
vi.mock("@/lib/image-bed/constants", () => ({
  UPLOAD_DIR: "/tmp/vcontrolhub-image-delete-test",
}));
vi.mock("@/lib/http/rate-limit-presets", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http/rate-limit-presets")>("@/lib/http/rate-limit-presets");
  return { ...actual, withRateLimit: vi.fn().mockResolvedValue({ allowed: true }) };
});

import { DELETE } from "../route";

const session = { userId: "u_1", username: "alice" };

describe("/api/images/[id]", () => {
  it("allows image owners to delete their image after removing backing files", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockReturnValue(false);
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_1",
      userId: "u_1",
      storageKey: "img.png",
      storageNodeId: null,
      relativePath: null,
    });
    unlinkMock.mockResolvedValue(undefined);
    imageDeleteMock.mockResolvedValueOnce({ id: "img_1" });

    const response = await DELETE(
      new Request("https://example.com/api/images/img_1", { method: "DELETE" }),
      {
        params: Promise.resolve({ id: "img_1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(requireApiSessionMock).toHaveBeenCalled();
    expect(unlinkMock).toHaveBeenCalledWith(
      "/tmp/vcontrolhub-image-delete-test/img.png",
    );
    expect(imageDeleteMock).toHaveBeenCalledWith({ where: { id: "img_1" } });
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });

  it("keeps the image record when the primary backing file cannot be removed", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockReturnValue(false);
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_1",
      userId: "u_1",
      storageKey: "img.png",
      storageNodeId: null,
      relativePath: null,
    });
    unlinkMock.mockRejectedValueOnce(Object.assign(new Error("EACCES"), { code: "EACCES" }));

    const response = await DELETE(
      new Request("https://example.com/api/images/img_1", { method: "DELETE" }),
      {
        params: Promise.resolve({ id: "img_1" }),
      },
    );

    expect(response.status).toBe(502);
    expect(imageDeleteMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: "图片文件删除失败，记录未删除",
    });
  });

  it("deletes linked LOCAL storage copies before deleting the image record", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockReturnValue(false);
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_1",
      userId: "u_1",
      storageKey: "img.png",
      storageNodeId: "node_1",
      relativePath: "album/subdir",
    });
    storageFindUniqueMock.mockResolvedValueOnce({
      driver: "LOCAL",
      basePath: "/srv/images",
    });
    unlinkMock.mockResolvedValue(undefined);
    imageDeleteMock.mockResolvedValueOnce({ id: "img_1" });

    const response = await DELETE(
      new Request("https://example.com/api/images/img_1", { method: "DELETE" }),
      {
        params: Promise.resolve({ id: "img_1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(unlinkMock).toHaveBeenCalledWith(
      "/tmp/vcontrolhub-image-delete-test/img.png",
    );
    expect(unlinkMock).toHaveBeenCalledWith("/srv/images/album/subdir/img.png");
    expect(imageDeleteMock).toHaveBeenCalledWith({ where: { id: "img_1" } });
  });

  it("keeps the image record when a linked LOCAL storage copy cannot be removed", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockReturnValue(false);
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_1",
      userId: "u_1",
      storageKey: "img.png",
      storageNodeId: "node_1",
      relativePath: "album/subdir",
    });
    storageFindUniqueMock.mockResolvedValueOnce({
      driver: "LOCAL",
      basePath: "/srv/images",
    });
    unlinkMock.mockRejectedValueOnce(Object.assign(new Error("EACCES"), { code: "EACCES" }));

    const response = await DELETE(
      new Request("https://example.com/api/images/img_1", { method: "DELETE" }),
      {
        params: Promise.resolve({ id: "img_1" }),
      },
    );

    expect(response.status).toBe(502);
    expect(imageDeleteMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: "存储节点图片副本删除失败，记录未删除",
    });
  });

  it("rejects deletion by non-owner non-admin sessions", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockReturnValue(false);
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_2",
      userId: "u_2",
      storageKey: "img.png",
      storageNodeId: null,
      relativePath: null,
    });

    const response = await DELETE(
      new Request("https://example.com/api/images/img_2", { method: "DELETE" }),
      {
        params: Promise.resolve({ id: "img_2" }),
      },
    );

    expect(response.status).toBe(403);
    expect(imageDeleteMock).not.toHaveBeenCalled();
  });

  it("does not treat user:read as cross-user image delete permission", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) => permission === "user:read",
    );
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_2",
      userId: "u_2",
      storageKey: "nested/img.png",
      storageNodeId: null,
      relativePath: null,
    });

    const response = await DELETE(
      new Request("https://example.com/api/images/img_2", { method: "DELETE" }),
      {
        params: Promise.resolve({ id: "img_2" }),
      },
    );

    expect(response.status).toBe(403);
    expect(imageDeleteMock).not.toHaveBeenCalled();
  });

  it("allows explicit storage delete permission to delete another user's image", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) => permission === "storage:delete",
    );
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_2",
      userId: "u_2",
      storageKey: "nested/img.png",
      storageNodeId: null,
      relativePath: null,
    });
    unlinkMock.mockResolvedValue(undefined);
    imageDeleteMock.mockResolvedValueOnce({ id: "img_2" });

    const response = await DELETE(
      new Request("https://example.com/api/images/img_2", { method: "DELETE" }),
      {
        params: Promise.resolve({ id: "img_2" }),
      },
    );

    expect(response.status).toBe(200);
    expect(unlinkMock).toHaveBeenCalledWith(
      "/tmp/vcontrolhub-image-delete-test/nested/img_thumb.webp",
    );
    expect(imageDeleteMock).toHaveBeenCalledWith({ where: { id: "img_2" } });
  });
});

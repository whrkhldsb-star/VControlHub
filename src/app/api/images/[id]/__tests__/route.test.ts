import { describe, expect, it, vi } from "vitest";

const {
  requireApiSessionMock,
  sessionHasPermissionMock,
  imageFindUniqueMock,
  imageDeleteMock,
  storageFindFirstMock,
  mediaDeleteManyMock,
  fileDeleteManyMock,
  transactionMock,
  unlinkMock,
} = vi.hoisted(() => ({
  requireApiSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  imageFindUniqueMock: vi.fn(),
  imageDeleteMock: vi.fn(),
  storageFindFirstMock: vi.fn(),
  mediaDeleteManyMock: vi.fn(),
  fileDeleteManyMock: vi.fn(),
  transactionMock: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
  unlinkMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: requireApiSessionMock,

  isSessionPayload: (value: unknown) => Boolean(value),
}));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: sessionHasPermissionMock,
}));
vi.mock("@/lib/auth/team-scope", () => ({
  teamWhere: () => ({ OR: [{ teamId: "team_1" }, { teamId: null }] }),
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
      findFirst: storageFindFirstMock,
    },
    mediaItem: { deleteMany: mediaDeleteManyMock },
    fileEntry: { deleteMany: fileDeleteManyMock },
    $transaction: transactionMock,
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

const session = {
  userId: "u_1",
  username: "alice",
  roles: ["operator"] as string[],
  currentTeamId: "team_1" as string | null,
  mustChangePassword: false,
};

describe("/api/images/[id]", () => {
  it("allows image owners to delete their image after removing backing files", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session: unknown, permission: string) => permission === "image:write",
    );
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
    sessionHasPermissionMock.mockImplementation(
      (_session: unknown, permission: string) => permission === "image:write",
    );
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
      error: "Failed to delete image file, record not deleted",
    });
  });

  it("deletes linked LOCAL storage copies before deleting the image record", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session: unknown, permission: string) => permission === "image:write",
    );
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_1",
      userId: "u_1",
      storageKey: "img.png",
      storageNodeId: "node_1",
      relativePath: "album/img.png",
    });
    storageFindFirstMock.mockResolvedValueOnce({
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
    expect(unlinkMock).toHaveBeenCalledWith("/srv/images/album/img.png");
    expect(mediaDeleteManyMock).toHaveBeenCalledWith({
      where: { storageNodeId: "node_1", relativePath: "album/img.png" },
    });
    expect(fileDeleteManyMock).toHaveBeenCalledWith({
      where: { storageNodeId: "node_1", relativePath: "album/img.png" },
    });
    expect(transactionMock).toHaveBeenCalled();
    expect(imageDeleteMock).toHaveBeenCalledWith({ where: { id: "img_1" } });
  });

  it("keeps the image record when a linked LOCAL storage copy cannot be removed", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session: unknown, permission: string) => permission === "image:write",
    );
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_1",
      userId: "u_1",
      storageKey: "img.png",
      storageNodeId: "node_1",
      relativePath: "album/subdir",
    });
    storageFindFirstMock.mockResolvedValueOnce({
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
      error: "Failed to delete image copy from storage node, record not deleted",
    });
  });

  it("rejects deletion by non-owner non-admin sessions", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session: unknown, permission: string) => permission === "image:write",
    );
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
      (_session, permission) =>
        permission === "image:write" || permission === "user:read",
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
      (_session, permission) =>
        permission === "image:write" || permission === "storage:delete",
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


  it("skips storage cascade when node is outside team scope", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session: unknown, permission: string) => permission === "image:write",
    );
    imageFindUniqueMock.mockResolvedValueOnce({
      id: "img_1",
      userId: "u_1",
      storageKey: "img.png",
      storageNodeId: "node_foreign",
      relativePath: "album/img.png",
    });
    storageFindFirstMock.mockResolvedValueOnce(null);
    unlinkMock.mockResolvedValue(undefined);
    imageDeleteMock.mockResolvedValueOnce({ id: "img_1" });

    const response = await DELETE(
      new Request("https://example.com/api/images/img_1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "img_1" }) },
    );

    expect(response.status).toBe(200);
    expect(mediaDeleteManyMock).not.toHaveBeenCalled();
    expect(fileDeleteManyMock).not.toHaveBeenCalled();
    expect(imageDeleteMock).toHaveBeenCalledWith({ where: { id: "img_1" } });
  });
});

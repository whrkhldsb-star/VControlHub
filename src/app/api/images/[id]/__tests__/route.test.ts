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
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, unlink: unlinkMock };
});
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

import { DELETE } from "../route";

const session = { userId: "u_1", username: "alice" };

describe("/api/images/[id]", () => {
  it("allows image owners to delete their image", async () => {
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
    expect(imageDeleteMock).toHaveBeenCalledWith({ where: { id: "img_1" } });
    await expect(response.json()).resolves.toMatchObject({ success: true });
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
});

import { describe, expect, it, vi } from "vitest";

const { requireApiPermissionMock, mediaFindUniqueMock, mediaUpdateMock } =
  vi.hoisted(() => ({
    requireApiPermissionMock: vi.fn(),
    mediaFindUniqueMock: vi.fn(),
    mediaUpdateMock: vi.fn(),
  }));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    mediaItem: {
      findUnique: mediaFindUniqueMock,
      update: mediaUpdateMock,
    },
  },
}));

import { PATCH } from "../route";

const session = { userId: "u_1", username: "alice" };

describe("/api/media/[id]", () => {
  it("updates media metadata with media manage permission", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({ session });
    mediaFindUniqueMock.mockResolvedValueOnce({
      id: "m_1",
      favorite: false,
      tags: [],
    });
    mediaUpdateMock.mockResolvedValueOnce({
      id: "m_1",
      favorite: true,
      tags: ["cat"],
    });

    const response = await PATCH(
      new Request("https://example.com/api/media/m_1", {
        method: "PATCH",
        body: JSON.stringify({ favorite: true, tags: ["cat"] }),
      }),
      { params: Promise.resolve({ id: "m_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireApiPermissionMock).toHaveBeenCalledWith("media:manage");
    expect(mediaUpdateMock).toHaveBeenCalledWith({
      where: { id: "m_1" },
      data: { favorite: true, tags: ["cat"] },
    });
    expect(body.item).toMatchObject({ favorite: true });
  });

  it("returns 404 when media item does not exist", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({ session });
    mediaFindUniqueMock.mockResolvedValueOnce(null);

    const response = await PATCH(
      new Request("https://example.com/api/media/missing", {
        method: "PATCH",
        body: JSON.stringify({ favorite: true }),
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );

    expect(response.status).toBe(404);
    expect(mediaUpdateMock).not.toHaveBeenCalled();
  });
});

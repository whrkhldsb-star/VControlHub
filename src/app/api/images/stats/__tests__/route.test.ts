import { describe, expect, it, vi } from "vitest";

const {
  requireApiSessionMock,
  sessionHasPermissionMock,
  imageCountMock,
  imageAggregateMock,
  imageGroupByMock,
  imageFindManyMock,
} = vi.hoisted(() => ({
  requireApiSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  imageCountMock: vi.fn(),
  imageAggregateMock: vi.fn(),
  imageGroupByMock: vi.fn(),
  imageFindManyMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: requireApiSessionMock,

  isSessionPayload: (value: unknown) => Boolean(value && typeof value === "object" && value !== null && "userId" in value),
}));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: sessionHasPermissionMock,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    imageUpload: {
      count: imageCountMock,
      aggregate: imageAggregateMock,
      groupBy: imageGroupByMock,
      findMany: imageFindManyMock,
    },
  },
}));

import { GET } from "../route";

const session = { userId: "u_1", username: "alice" };

describe("/api/images/stats", () => {
  it("returns user-scoped image stats for non-admin sessions", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session: unknown, permission: string) => permission === "image:read",
    );
    imageCountMock.mockResolvedValueOnce(2);
    imageAggregateMock.mockResolvedValueOnce({
      _sum: { sizeBytes: 1024 * 1024 },
    });
    imageGroupByMock.mockResolvedValueOnce([
      { album: "cats", _count: { id: 2 }, _sum: { sizeBytes: 1024 * 1024 } },
    ]);
    imageFindManyMock.mockResolvedValueOnce([
      { createdAt: new Date("2026-05-29T00:00:00Z") },
    ]);

    const response = await GET(
      new Request("https://example.com/api/images/stats"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requireApiSessionMock).toHaveBeenCalled();
    expect(imageCountMock).toHaveBeenCalledWith({ where: { userId: "u_1" } });
    expect(body).toMatchObject({
      totalCount: 2,
      totalSizeBytes: 1024 * 1024,
      totalSizeMB: 1,
    });
    expect(body.albums[0]).toMatchObject({ album: "cats", count: 2 });
  });

  it("does not treat user:read as fleet-wide image stats permission", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) => permission === "image:read" || permission === "user:read",
    );
    imageCountMock.mockResolvedValueOnce(1);
    imageAggregateMock.mockResolvedValueOnce({ _sum: { sizeBytes: 512 } });
    imageGroupByMock.mockResolvedValueOnce([]);
    imageFindManyMock.mockResolvedValueOnce([]);

    const response = await GET(
      new Request("https://example.com/api/images/stats"),
    );
    expect(response.status).toBe(200);
    expect(imageCountMock).toHaveBeenCalledWith({ where: { userId: "u_1" } });
  });

  it("allows team/media managers to read fleet-wide image stats", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) =>
        permission === "image:read" || permission === "media:manage",
    );
    imageCountMock.mockResolvedValueOnce(9);
    imageAggregateMock.mockResolvedValueOnce({ _sum: { sizeBytes: 2048 } });
    imageGroupByMock.mockResolvedValueOnce([]);
    imageFindManyMock.mockResolvedValueOnce([]);

    const response = await GET(
      new Request("https://example.com/api/images/stats"),
    );
    expect(response.status).toBe(200);
    expect(imageCountMock).toHaveBeenCalledWith({ where: {} });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

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

const session = {
  userId: "u_1",
  username: "alice",
  roles: [] as string[],
  currentTeamId: "team_a" as string | null,
};

describe("/api/images/stats", () => {
  beforeEach(() => {
    imageCountMock.mockReset().mockResolvedValue(0);
    imageAggregateMock.mockReset().mockResolvedValue({ _sum: { sizeBytes: 0 } });
    imageGroupByMock.mockReset().mockResolvedValue([]);
  });
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

  it("allows team managers to read fleet-wide image stats", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) =>
        permission === "image:read" || permission === "team:manage",
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

  it("scopes media managers image stats to current team", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) =>
        permission === "image:read" || permission === "media:manage",
    );
    imageCountMock.mockResolvedValueOnce(3);
    imageAggregateMock.mockResolvedValueOnce({ _sum: { sizeBytes: 99 } });
    imageGroupByMock.mockResolvedValueOnce([]);
    imageFindManyMock.mockResolvedValueOnce([]);

    const response = await GET(
      new Request("https://example.com/api/images/stats"),
    );
    expect(response.status).toBe(200);
    expect(imageCountMock).toHaveBeenCalledWith({
      where: { teamId: "team_a" },
    });
  });

  it.each([
    { permission: "image:read", scope: { userId: "u_1" } },
    { permission: "media:manage", scope: { teamId: "team_a" } },
    { permission: "team:manage", scope: {} },
  ])("counts more than 5000 uploads without truncation in the $permission scope", async ({ permission, scope }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockImplementation((_session, required) => required === "image:read" || required === permission);
    imageCountMock.mockImplementation(({ where }) => {
      const { createdAt, ...actualScope } = where;
      expect(actualScope).toEqual(scope);
      if (!createdAt) return Promise.resolve(6002);
      return Promise.resolve(createdAt.gte.toISOString() === "2026-09-08T00:00:00.000Z" ? 6001 : 0);
    });
    const response = await GET(new Request("https://example.com/api/images/stats"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ totalCount: 6002, uploadTrend: [{ date: "2026-09-08", count: 6001 }] });
    const ranges = imageCountMock.mock.calls.map(([args]) => args.where.createdAt).filter(Boolean);
    expect(ranges).toHaveLength(7);
    expect(ranges[0].gte.toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(ranges.at(-1).lt.toISOString()).toBe("2026-09-09T00:00:00.000Z");
    for (let index = 1; index < ranges.length; index++) expect(ranges[index].gte).toEqual(ranges[index - 1].lt);
    expect(imageFindManyMock).not.toHaveBeenCalled();
  });
});

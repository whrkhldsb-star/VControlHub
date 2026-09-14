import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireApiSessionMock,
  sessionHasPermissionMock,
  authenticateBearerMock,
  imageFindManyMock,
  imageCountMock,
} = vi.hoisted(() => ({
  requireApiSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  authenticateBearerMock: vi.fn(),
  imageFindManyMock: vi.fn(),
  imageCountMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: requireApiSessionMock,

  isSessionPayload: (value: unknown) => Boolean(value && typeof value === "object" && value !== null && "userId" in value),
}));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: sessionHasPermissionMock,
}));
vi.mock("@/lib/auth/bearer-token", () => ({
  authenticateBearerForPermissions: authenticateBearerMock,
  hasBearerAuthorization: (request: Request) =>
    /^Bearer\s+/i.test(request.headers.get("authorization") ?? ""),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    imageUpload: { findMany: imageFindManyMock, count: imageCountMock },
    $transaction: (callback: (tx: unknown) => unknown) => callback({ imageUpload: { findMany: imageFindManyMock, count: imageCountMock } }),
  },
}));

import { GET } from "../route";

const session = {
  userId: "u1",
  username: "admin",
  roles: ["admin"],
  currentTeamId: "team_a",
};

describe("GET /api/images/list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue(session);
    sessionHasPermissionMock.mockImplementation(
      (_session: unknown, permission: string) => permission === "image:read",
    );
    authenticateBearerMock.mockResolvedValue(null);
    imageFindManyMock.mockResolvedValue([{ id: "img_1" }]);
    imageCountMock.mockResolvedValue(1);
  });

  it("uses shared session guard for cookie callers", async () => {
    const response = await GET(
      new Request("http://local/api/images/list?page=1&limit=10"),
    );
    expect(response.status).toBe(200);
    expect(requireApiSessionMock).toHaveBeenCalled();
    expect(imageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1" }, take: 10 }),
    );
  });

  it("keeps Bearer token image:read access without requiring a session", async () => {
    authenticateBearerMock.mockResolvedValueOnce({
      userId: "api_user",
      tokenId: "tok_1",
      scopes: ["image:read"],
      session: {
        ...session,
        userId: "api_user",
        currentTeamId: "team_token",
        roles: [],
        permissions: ["image:read"],
      },
    });

    const response = await GET(
      new Request("http://local/api/images/list", {
        headers: { authorization: "Bearer whr_fake" },
      }),
    );
    expect(response.status).toBe(200);
    expect(requireApiSessionMock).not.toHaveBeenCalled();
    expect(imageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "api_user" } }),
    );
  });

  it("does not fall back to a cookie session when an explicit Bearer token is invalid", async () => {
    const response = await GET(
      new Request("http://local/api/images/list", {
        headers: { authorization: "Bearer revoked-token" },
      }),
    );

    expect(response.status).toBe(401);
    expect(requireApiSessionMock).not.toHaveBeenCalled();
    expect(imageFindManyMock).not.toHaveBeenCalled();
  });

  it("lets team managers request all images fleet-wide", async () => {
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) =>
        permission === "image:read" || permission === "team:manage",
    );

    const response = await GET(
      new Request("http://local/api/images/list?all=true"),
    );
    expect(response.status).toBe(200);
    expect(sessionHasPermissionMock).toHaveBeenCalledWith(session, "team:manage");
    // team:manage → teamWhere is empty (global)
    expect(imageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it("scopes media managers showAll to current team (no cross-tenant leak)", async () => {
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) =>
        permission === "image:read" || permission === "media:manage",
    );

    const response = await GET(
      new Request("http://local/api/images/list?all=true"),
    );
    expect(response.status).toBe(200);
    expect(imageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { teamId: "team_a" },
      }),
    );
  });

  it("does not treat user:read as permission to list all images", async () => {
    sessionHasPermissionMock.mockImplementation(
      (_session, permission) =>
        permission === "image:read" || permission === "user:read",
    );

    const response = await GET(
      new Request("http://local/api/images/list?all=true"),
    );
    expect(response.status).toBe(200);
    expect(imageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1" } }),
    );
  });

  it("clamps a stale page and sorts ties consistently after deletion", async () => {
    imageCountMock.mockResolvedValueOnce(31);
    const response = await GET(new Request("http://local/api/images/list?page=999&limit=30"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ page: 2, totalPages: 2, total: 31 });
    expect(imageFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ skip: 30, take: 30, orderBy: [{ createdAt: "desc" }, { id: "asc" }] }));
  });

  it("returns page one for an empty result set", async () => {
    imageCountMock.mockResolvedValueOnce(0);
    imageFindManyMock.mockResolvedValueOnce([]);
    const response = await GET(new Request("http://local/api/images/list?page=2"));
    expect(await response.json()).toMatchObject({ images: [], page: 1, totalPages: 1, total: 0 });
    expect(imageFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));
  });

  it.each(["page=0", "page=1000001", "page=invalid", "limit=101"])("normalizes invalid Bearer query %s to a 400 response", async (query) => {
    authenticateBearerMock.mockResolvedValueOnce({ session });
    const response = await GET(new Request(`http://local/api/images/list?${query}`, {
      headers: { authorization: "Bearer valid-token" },
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(imageCountMock).not.toHaveBeenCalled();
    expect(requireApiSessionMock).not.toHaveBeenCalled();
  });

  it("returns a sanitized JSON error when a Bearer listing fails", async () => {
    authenticateBearerMock.mockResolvedValueOnce({ session });
    imageCountMock.mockRejectedValueOnce(new Error("private database connection details"));
    const response = await GET(new Request("http://local/api/images/list", {
      headers: { authorization: "Bearer valid-token" },
    }));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "INTERNAL_ERROR", message: "Failed to fetch image list" });
  });

  it("keeps elevated Bearer callers restricted to their own images", async () => {
    authenticateBearerMock.mockResolvedValueOnce({ session });
    sessionHasPermissionMock.mockReturnValue(true);
    const response = await GET(new Request("http://local/api/images/list?all=true", {
      headers: { authorization: "Bearer valid-token" },
    }));
    expect(response.status).toBe(200);
    expect(imageFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "u1" } }));
  });

  it("preserves an insufficient-scope rejection without cookie fallback", async () => {
    authenticateBearerMock.mockResolvedValueOnce(Response.json({ error: "Insufficient scope" }, { status: 403 }));
    const response = await GET(new Request("http://local/api/images/list", {
      headers: { authorization: "Bearer insufficient-scope" },
    }));
    expect(response.status).toBe(403);
    expect(requireApiSessionMock).not.toHaveBeenCalled();
    expect(imageCountMock).not.toHaveBeenCalled();
  });
});

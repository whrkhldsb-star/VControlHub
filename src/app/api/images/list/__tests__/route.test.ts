import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireApiSessionMock,
  sessionHasPermissionMock,
  verifyBearerTokenMock,
  imageFindManyMock,
  imageCountMock,
} = vi.hoisted(() => ({
  requireApiSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  verifyBearerTokenMock: vi.fn(),
  imageFindManyMock: vi.fn(),
  imageCountMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: requireApiSessionMock,
}));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: sessionHasPermissionMock,
}));
vi.mock("@/lib/auth/bearer-token", () => ({
  verifyBearerToken: verifyBearerTokenMock,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    imageUpload: { findMany: imageFindManyMock, count: imageCountMock },
  },
}));

import { GET } from "../route";

const session = { userId: "u1", username: "admin", roles: ["admin"] };

describe("GET /api/images/list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue(session);
    sessionHasPermissionMock.mockReturnValue(false);
    verifyBearerTokenMock.mockResolvedValue(null);
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
    verifyBearerTokenMock.mockResolvedValueOnce({
      userId: "api_user",
      tokenId: "tok_1",
      scopes: ["image:read"],
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

  it("lets admins request all images", async () => {
    sessionHasPermissionMock.mockReturnValueOnce(true);

    const response = await GET(
      new Request("http://local/api/images/list?all=true"),
    );
    expect(response.status).toBe(200);
    expect(imageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });
});

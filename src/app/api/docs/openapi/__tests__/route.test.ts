import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiSessionMock } = vi.hoisted(() => ({
  requireApiSessionMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: requireApiSessionMock,

  isSessionPayload: (value: unknown) => Boolean(value),
}));

import { GET } from "../route";

describe("GET /api/docs/openapi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue({
      userId: "u1",
      username: "admin",
      permissions: ["*"],
    });
  });

  it("serves the authenticated OpenAPI spec at the route used by the API docs page", async () => {
    const response = await GET(new Request("http://local/api/docs/openapi"));
    expect(response.status).toBe(200);
    expect(requireApiSessionMock).toHaveBeenCalled();

    const body = await response.json();
    expect(body.openapi).toBe("3.0.3");
    expect(body.info.title).toContain("API");
    expect(body.paths).toHaveProperty("/login");
    expect(body.components.securitySchemes.apiTokenAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
    expect(body.paths["/images/upload"].post.responses).toHaveProperty("201");
    expect(body.paths["/images/upload"].post.security).toContainEqual({
      apiTokenAuth: [],
    });
    for (const path of ["/servers/monitor", "/storage/local", "/storage/sftp"]) {
      expect(body.paths[path].get.security).toContainEqual({ apiTokenAuth: [] });
    }
  });
});

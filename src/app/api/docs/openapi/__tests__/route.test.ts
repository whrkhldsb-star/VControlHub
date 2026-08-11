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
    expect(Object.keys(body.paths)).toHaveLength(178);
    expect(body.paths["/settings"]).toHaveProperty("patch");
    expect(body.paths["/settings"]).not.toHaveProperty("put");
    expect(body.paths["/storage/sftp"]).not.toHaveProperty("post");
    expect(body.paths["/backups/{id}/restore"].post.parameters).toContainEqual(
      expect.objectContaining({ name: "id", in: "path", required: true }),
    );
    expect(body.paths["/backups/{id}/restore"].post["x-vcontrolhub-permissions"]).toContain("backup:restore");
    expect(body.paths["/login"].post.security).toEqual([]);
    expect(body.paths["/auth/2fa/verify-login"].post.security).toEqual([]);
    expect(body.paths["/status"].get.security).toEqual([]);
    expect(body.paths["/share/{token}"].get.security).toEqual([]);
    expect(body.paths["/webdav/{storageNodeId}/{path}"].get.security).toEqual([
      { basicAuth: [] },
    ]);
    expect(body.paths["/itsm/inbound/{connectionId}"].post.security).toEqual([
      { webhookSignature: [] },
    ]);
    for (const path of ["/servers/monitor", "/storage/local", "/storage/sftp"]) {
      expect(body.paths[path].get.security).toContainEqual({ apiTokenAuth: [] });
    }
  });
});

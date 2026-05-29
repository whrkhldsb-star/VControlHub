import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiSessionMock } = vi.hoisted(() => ({
  requireApiSessionMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: requireApiSessionMock,
}));

import { GET } from "../route";

describe("GET /api/docs/openapi.json", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue({
      userId: "u1",
      username: "admin",
      permissions: ["*"],
    });
  });

  it("serves the same authenticated OpenAPI spec URL embedded in the docs UI", async () => {
    const response = await GET(
      new Request("http://local/api/docs/openapi.json"),
    );
    expect(response.status).toBe(200);
    expect(requireApiSessionMock).toHaveBeenCalled();

    const body = await response.json();
    expect(body.openapi).toBe("3.0.3");
    expect(body.info.title).toContain("API");
    expect(body.paths).toHaveProperty("/login");
  });
});

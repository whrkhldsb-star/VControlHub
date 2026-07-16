import { describe, expect, it, vi } from "vitest";

const { requireApiPermissionMock, updateMediaTagsMock } = vi.hoisted(() => ({
  requireApiPermissionMock: vi.fn(),
  updateMediaTagsMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));

vi.mock("@/lib/media/service", () => ({
  updateMediaTags: updateMediaTagsMock,
}));

import { PATCH } from "../route";

const session = { userId: "u_1", username: "alice", roles: ["operator"], currentTeamId: "team_a" };

describe("/api/media/[id]", () => {
  it("updates media metadata via team-scoped updateMediaTags", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({ session });
    updateMediaTagsMock.mockResolvedValueOnce({
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
    expect(updateMediaTagsMock).toHaveBeenCalledWith({
      id: "m_1",
      tags: ["cat"],
      favorite: true,
      session,
    });
    expect(body.item).toMatchObject({ favorite: true });
  });

  it("returns 404 when media item is missing or out of team scope", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({ session });
    const { NotFoundError } = await import("@/lib/errors");
    updateMediaTagsMock.mockRejectedValueOnce(new NotFoundError("Media item not found"));

    const response = await PATCH(
      new Request("https://example.com/api/media/missing", {
        method: "PATCH",
        body: JSON.stringify({ favorite: true }),
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );

    expect(response.status).toBe(404);
    expect(updateMediaTagsMock).toHaveBeenCalledWith({
      id: "missing",
      tags: undefined,
      favorite: true,
      session,
    });
  });
});

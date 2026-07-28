import { beforeEach, describe, expect, it, vi } from "vitest";

const { serverFindUniqueMock, sessionHasPermissionMock } = vi.hoisted(() => ({
  serverFindUniqueMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    server: { findUnique: serverFindUniqueMock },
  },
}));

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: sessionHasPermissionMock,
}));

import { assertServerTeamAccess } from "../team-access";

describe("assertServerTeamAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionHasPermissionMock.mockReturnValue(false);
  });

  it("does not expose an unassigned server to a non-manager", async () => {
    serverFindUniqueMock.mockResolvedValue({ id: "server_legacy", teamId: null });

    const result = await assertServerTeamAccess(
      {
        userId: "user_1",
        username: "operator",
        roles: ["operator"],
        mustChangePassword: false,
        currentTeamId: "team_1",
      },
      "server_legacy",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it("keeps unassigned servers available to platform team managers", async () => {
    serverFindUniqueMock.mockResolvedValue({ id: "server_legacy", teamId: null });
    sessionHasPermissionMock.mockReturnValue(true);

    const result = await assertServerTeamAccess(
      {
        userId: "admin_1",
        username: "admin",
        roles: ["admin"],
        mustChangePassword: false,
        currentTeamId: null,
      },
      "server_legacy",
    );

    expect(result).toEqual({
      ok: true,
      server: { id: "server_legacy", teamId: null },
    });
  });
});
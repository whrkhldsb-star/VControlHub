import { beforeEach, describe, expect, it, vi } from "vitest";

const { serverFindUniqueMock, sessionHasPermissionMock, userServerAccessFindUniqueMock } = vi.hoisted(() => ({
  serverFindUniqueMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  userServerAccessFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    server: { findUnique: serverFindUniqueMock },
    userServerAccess: { findUnique: userServerAccessFindUniqueMock },
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
    userServerAccessFindUniqueMock.mockResolvedValue(null);
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

  it("denies a specific operation when a server override disables it", async () => {
    serverFindUniqueMock.mockResolvedValue({ id: "server_1", teamId: "team_1" });
    userServerAccessFindUniqueMock.mockResolvedValue({ canFileWrite: false });
    const session = {
      userId: "user_1", username: "operator", roles: ["operator" as const],
      mustChangePassword: false, currentTeamId: "team_1",
    };
    const denied = await assertServerTeamAccess(session, "server_1", "fileWrite");
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.response.status).toBe(404);
    expect(userServerAccessFindUniqueMock).toHaveBeenCalledWith({
      where: { userId_serverId: { userId: "user_1", serverId: "server_1" } },
      select: { canFileWrite: true },
    });
    userServerAccessFindUniqueMock.mockResolvedValue({ canFileWrite: true });
    expect((await assertServerTeamAccess(session, "server_1", "fileWrite")).ok).toBe(true);
  });

  it("narrows every customer account by its per-server rows, whatever its template", async () => {
    serverFindUniqueMock.mockResolvedValue({ id: "server_1", teamId: "team_1" });
    userServerAccessFindUniqueMock.mockResolvedValue({ canManage: false });
    const result = await assertServerTeamAccess({
      userId: "customer_admin",
      username: "customer-admin",
      roles: [],
      permissions: ["server:write", "server:ssh"],
      mustChangePassword: false,
      currentTeamId: "team_1",
    }, "server_1", "manage");
    expect(result.ok).toBe(false);
  });
});

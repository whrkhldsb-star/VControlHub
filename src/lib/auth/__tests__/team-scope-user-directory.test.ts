import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleKey } from "@/lib/auth/rbac";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    sessionHasPermission: vi.fn(),
    prisma: {
      teamMember: {
        findUnique: vi.fn(),
      },
    },
  },
}));

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: mocks.sessionHasPermission,
}));

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

const {
  assertUserInActorScope,
  isGlobalTeamManager,
  userDirectoryWhere,
} = await import("@/lib/auth/team-scope");

describe("user directory team scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats team:manage as global", () => {
    mocks.sessionHasPermission.mockImplementation(
      (_session, permission) => permission === "team:manage",
    );
    const session = {
      userId: "admin",
      roles: ["admin"] as RoleKey[],
      currentTeamId: "team-a",
    };
    expect(isGlobalTeamManager(session)).toBe(true);
    expect(userDirectoryWhere(session)).toEqual({});
  });

  it("scopes list to current team members + self", () => {
    mocks.sessionHasPermission.mockReturnValue(false);
    expect(
      userDirectoryWhere({
        userId: "u1",
        roles: ["operator"] as RoleKey[],
        currentTeamId: "team-a",
      }),
    ).toEqual({
      OR: [
        { id: "u1" },
        { teamMemberships: { some: { teamId: "team-a" } } },
      ],
    });
  });

  it("falls back to self-only when no current team", () => {
    mocks.sessionHasPermission.mockReturnValue(false);
    expect(
      userDirectoryWhere({
        userId: "u1",
        roles: ["viewer"] as RoleKey[],
        currentTeamId: null,
      }),
    ).toEqual({ id: "u1" });
  });

  it("assertUserInActorScope allows self and global managers without DB", async () => {
    mocks.sessionHasPermission.mockReturnValue(true);
    await expect(
      assertUserInActorScope(
        { userId: "u1", roles: ["admin"] as RoleKey[], currentTeamId: null },
        "other",
      ),
    ).resolves.toBeUndefined();
    expect(mocks.prisma.teamMember.findUnique).not.toHaveBeenCalled();

    mocks.sessionHasPermission.mockReturnValue(false);
    await expect(
      assertUserInActorScope(
        { userId: "u1", roles: ["viewer"] as RoleKey[], currentTeamId: "team-a" },
        "u1",
      ),
    ).resolves.toBeUndefined();
    expect(mocks.prisma.teamMember.findUnique).not.toHaveBeenCalled();
  });

  it("assertUserInActorScope rejects out-of-team users with 404", async () => {
    mocks.sessionHasPermission.mockReturnValue(false);
    mocks.prisma.teamMember.findUnique.mockResolvedValueOnce(null);
    await expect(
      assertUserInActorScope(
        { userId: "u1", roles: ["operator"] as RoleKey[], currentTeamId: "team-a" },
        "foreign",
      ),
    ).rejects.toMatchObject({ status: 404, name: "NotFoundError" });

    mocks.prisma.teamMember.findUnique.mockResolvedValueOnce({ userId: "mate" });
    await expect(
      assertUserInActorScope(
        { userId: "u1", roles: ["operator"] as RoleKey[], currentTeamId: "team-a" },
        "mate",
      ),
    ).resolves.toBeUndefined();
  });

  it("assertUserInActorScope rejects foreign users when actor has no team", async () => {
    mocks.sessionHasPermission.mockReturnValue(false);
    await expect(
      assertUserInActorScope(
        { userId: "u1", roles: ["viewer"] as RoleKey[], currentTeamId: null },
        "foreign",
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.prisma.teamMember.findUnique).not.toHaveBeenCalled();
  });
});

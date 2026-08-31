/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tenant isolation in this codebase is enforced by these `where`-fragment
 * builders, spread into service-layer queries. Every consumer test mocks this
 * module, so without this file nothing pins the semantics the whole isolation
 * model rests on.
 *
 * The distinction that matters: `teamWhere` treats `teamId: null` as SHARED,
 * while the security-root helpers (servers, command requests, sync jobs,
 * deployments, playbooks, images) treat it as QUARANTINED legacy data reachable
 * only by a global manager. Collapsing a strict helper back onto the loose shape
 * would hand every tenant the null-team rows — including runnable playbooks and
 * SSH-capable server records.
 */

import type { TeamSession } from "../team-scope";

const mocks = vi.hoisted(() => ({ teamMemberFindUnique: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: { teamMember: { findUnique: mocks.teamMemberFindUnique } },
}));
vi.mock("@/lib/i18n/service-translations", () => ({ t: (key: string) => key }));

const {
  assertUserInActorScope,
  commandRequestTeamWhere,
  deploymentRunTeamWhere,
  imageTeamWhere,
  isGlobalTeamManager,
  playbookTeamWhere,
  serverTeamWhere,
  syncJobTeamWhere,
  teamAccessFilter,
  teamCreateData,
  teamWhere,
  userDirectoryWhere,
} = await import("../team-scope");

/** `admin` is the only default role carrying team:manage. */
const ADMIN: TeamSession = { userId: "u_admin", roles: ["admin"], currentTeamId: null };
const ADMIN_IN_TEAM: TeamSession = { userId: "u_admin", roles: ["admin"], currentTeamId: "team_a" };
const MEMBER: TeamSession = { userId: "u_member", roles: ["operator"], currentTeamId: "team_a" };
const TEAMLESS: TeamSession = { userId: "u_free", roles: ["operator"], currentTeamId: null };

const STRICT_HELPERS = [
  ["serverTeamWhere", serverTeamWhere],
  ["commandRequestTeamWhere", commandRequestTeamWhere],
  ["syncJobTeamWhere", syncJobTeamWhere],
  ["deploymentRunTeamWhere", deploymentRunTeamWhere],
  ["playbookTeamWhere", playbookTeamWhere],
  ["imageTeamWhere", imageTeamWhere],
] as const;

describe("isGlobalTeamManager", () => {
  it("recognises team:manage and nothing weaker", () => {
    expect(isGlobalTeamManager(ADMIN)).toBe(true);
    // operator holds team:create and team:member:manage — neither is team:manage.
    expect(isGlobalTeamManager(MEMBER)).toBe(false);
    expect(isGlobalTeamManager({ ...MEMBER, roles: ["viewer"] })).toBe(false);
    expect(isGlobalTeamManager({ ...MEMBER, roles: [] })).toBe(false);
  });
});

describe("teamWhere (loose: null teamId is shared)", () => {
  it("applies no filter for a global manager", () => {
    expect(teamWhere(ADMIN)).toEqual({});
    expect(teamWhere(ADMIN_IN_TEAM)).toEqual({});
  });

  it("admits the current team plus unassigned rows", () => {
    expect(teamWhere(MEMBER)).toEqual({
      OR: [{ teamId: "team_a" }, { teamId: null }],
    });
  });

  it("admits only unassigned rows without a team context", () => {
    expect(teamWhere(TEAMLESS)).toEqual({ teamId: null });
  });

  it("never leaks another team's id into the fragment", () => {
    expect(JSON.stringify(teamWhere({ ...MEMBER, currentTeamId: "team_b" }))).not.toContain(
      "team_a",
    );
  });
});

describe("security-root helpers (strict: null teamId is quarantined)", () => {
  for (const [name, helper] of STRICT_HELPERS) {
    describe(name, () => {
      it("applies no filter for a global manager", () => {
        expect(helper(ADMIN)).toEqual({});
      });

      it("pins the current team exactly, with no unassigned branch", () => {
        expect(helper(MEMBER)).toEqual({ teamId: "team_a" });
      });

      it("matches nothing at all without a team context", () => {
        const fragment = helper(TEAMLESS);

        // Must not be an empty (= unfiltered) fragment, and must not fall back to
        // the loose `teamId: null` shape, which would expose quarantined rows.
        expect(fragment).not.toEqual({});
        expect(fragment).not.toEqual({ teamId: null });
        expect(fragment).toMatchObject({ id: expect.stringContaining("require_team_manage") });
      });

      it("never admits a null teamId for a non-manager", () => {
        for (const session of [MEMBER, TEAMLESS]) {
          expect(JSON.stringify(helper(session))).not.toContain('"teamId":null');
        }
      });
    });
  }
});

describe("userDirectoryWhere", () => {
  it("gives a global manager the whole directory", () => {
    expect(userDirectoryWhere(ADMIN)).toEqual({});
  });

  it("limits a member to themselves plus their team's members", () => {
    expect(userDirectoryWhere(MEMBER)).toEqual({
      OR: [
        { id: "u_member" },
        { teamMemberships: { some: { teamId: "team_a" } } },
      ],
    });
  });

  it("limits a teamless user to themselves, preventing global enumeration", () => {
    expect(userDirectoryWhere(TEAMLESS)).toEqual({ id: "u_free" });
  });
});

describe("assertUserInActorScope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets a global manager reach anyone without a lookup", async () => {
    await expect(assertUserInActorScope(ADMIN, "someone-else")).resolves.toBeUndefined();
    expect(mocks.teamMemberFindUnique).not.toHaveBeenCalled();
  });

  it("always lets the actor reach themselves", async () => {
    await expect(assertUserInActorScope(TEAMLESS, "u_free")).resolves.toBeUndefined();
    expect(mocks.teamMemberFindUnique).not.toHaveBeenCalled();
  });

  it("rejects any other id when the actor has no team", async () => {
    await expect(assertUserInActorScope(TEAMLESS, "u_other")).rejects.toThrow(
      "backend.team.userNotFound",
    );
    expect(mocks.teamMemberFindUnique).not.toHaveBeenCalled();
  });

  it("accepts a member of the actor's current team", async () => {
    mocks.teamMemberFindUnique.mockResolvedValue({ userId: "u_other" });

    await expect(assertUserInActorScope(MEMBER, "u_other")).resolves.toBeUndefined();
    expect(mocks.teamMemberFindUnique).toHaveBeenCalledWith({
      where: { teamId_userId: { teamId: "team_a", userId: "u_other" } },
      select: { userId: true },
    });
  });

  it("reports a non-member as not-found rather than forbidden", async () => {
    // A 403 would confirm the account exists; this surface must not leak that.
    mocks.teamMemberFindUnique.mockResolvedValue(null);

    await expect(assertUserInActorScope(MEMBER, "u_other")).rejects.toMatchObject({
      name: "NotFoundError",
    });
  });
});

describe("teamCreateData", () => {
  it("stamps the current team onto new records", () => {
    expect(teamCreateData({ currentTeamId: "team_a" })).toEqual({ teamId: "team_a" });
  });

  it("omits teamId entirely without a team context", () => {
    // Documented consequence: the row lands as teamId=null, which the loose
    // filter treats as shared and every strict helper quarantines.
    expect(teamCreateData({ currentTeamId: null })).toEqual({});
  });
});

describe("teamAccessFilter", () => {
  it("returns undefined — not {} — for a global manager", () => {
    // Callers spread this conditionally; {} and undefined are not interchangeable
    // at every call site, so the distinction is load-bearing.
    expect(teamAccessFilter(ADMIN)).toBeUndefined();
  });

  it("mirrors teamWhere for everyone else", () => {
    expect(teamAccessFilter(MEMBER)).toEqual(teamWhere(MEMBER));
    expect(teamAccessFilter(TEAMLESS)).toEqual(teamWhere(TEAMLESS));
  });
});

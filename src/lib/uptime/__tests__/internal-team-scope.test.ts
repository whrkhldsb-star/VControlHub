/**
 * getAllUptimeDataInternal team scoping.
 * Authenticated callers must pass session so non-admins only see their team.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyServer = vi.fn();
const findManySnapshot = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    server: { findMany: findManyServer },
    serverUptimeSnapshot: { findMany: findManySnapshot },
  },
}));

describe("getAllUptimeDataInternal team scope", () => {
  beforeEach(() => {
    findManyServer.mockReset();
    findManySnapshot.mockReset();
    findManyServer.mockResolvedValue([]);
    findManySnapshot.mockResolvedValue([]);
  });

  it("applies teamWhere when session is provided (non-admin with team)", async () => {
    const { getAllUptimeDataInternal } = await import("../internal");
    await getAllUptimeDataInternal({
      session: {
        userId: "u1",
        username: "op",
        roles: ["operator"],
        mustChangePassword: false,
        currentTeamId: "team_a",
      },
    });
    expect(findManyServer).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          enabled: true,
          OR: [{ teamId: "team_a" }, { teamId: null }],
        }),
      }),
    );
  });

  it("does not apply team filter for public (no session) listing", async () => {
    const { getAllUptimeDataInternal } = await import("../internal");
    await getAllUptimeDataInternal({});
    expect(findManyServer).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { enabled: true },
      }),
    );
  });
});

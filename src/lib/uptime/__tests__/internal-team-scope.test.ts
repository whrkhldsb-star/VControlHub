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
        roles: ["operator"],
        currentTeamId: "team_a",
      },
    });
    // The customer boundary AND the per-server access of the account (a customer account limited to some servers
    // used to be shown every server of the customer here).
    expect(findManyServer).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          enabled: true,
          AND: expect.arrayContaining([{ teamId: "team_a" }, expect.objectContaining({})]),
        }),
      }),
    );
    expect((findManyServer.mock.calls[0]![0].where.AND as unknown[]).length).toBe(2);
  });

  it("keeps the platform administrator's selected customer as the only boundary", async () => {
    const { getAllUptimeDataInternal } = await import("../internal");
    await getAllUptimeDataInternal({ session: { userId: "admin", roles: ["admin"], currentTeamId: "team_a" } });
    expect(findManyServer).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ enabled: true, teamId: "team_a" }) }));
  });

  it("fails closed instead of exposing server names without a session", async () => {
    const { getAllUptimeDataInternal } = await import("../internal");
    const result = await getAllUptimeDataInternal({});
    expect(result).toEqual({ servers: [] });
    expect(findManyServer).not.toHaveBeenCalled();
    expect(findManySnapshot).not.toHaveBeenCalled();
  });
});

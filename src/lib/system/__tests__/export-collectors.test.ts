/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Collector-level behaviour the service-level export test cannot see: the
 * paging loop that reads a whole table, and the per-table tenant filters that
 * decide what a team-scoped export is allowed to contain.
 */

const models = [
  "permission",
  "role",
  "rolePermission",
  "user",
  "userRole",
  "teamMember",
  "sshKey",
  "server",
  "storageNode",
  "userStorageAccess",
  "commandTemplate",
  "quickService",
  "playbook",
  "alertRule",
  "setting",
  "aiProvider",
  "announcement",
  "snippet",
] as const;

const prismaMock = vi.hoisted(() => ({ value: {} as Record<string, { findMany: ReturnType<typeof vi.fn> }> }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock.value }));

for (const name of models) {
  prismaMock.value[name] = { findMany: vi.fn().mockResolvedValue([]) };
}

const {
  exportPermissions,
  exportUserStorageAccess,
  exportUserRoles,
  exportSnippets,
  exportSettings,
  exportAiProviders,
  exportAnnouncements,
  exportQuickServices,
  exportStorageNodes,
} = await import("../export-collectors");

function model(name: (typeof models)[number]) {
  const m = prismaMock.value[name];
  if (!m) throw new Error(`no mock for ${name}`);
  return m;
}

beforeEach(() => {
  for (const name of models) model(name).findMany.mockReset().mockResolvedValue([]);
});

describe("readAllPages", () => {
  it("stops after one page when the table is smaller than the page size", async () => {
    model("permission").findMany.mockResolvedValueOnce([{ id: "p1", key: "a", name: "a", description: null }]);

    const rows = await exportPermissions();

    expect(rows).toHaveLength(1);
    expect(model("permission").findMany).toHaveBeenCalledTimes(1);
    expect(model("permission").findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500, skip: 0 }),
    );
  });

  it("asks for a second page when the first one comes back exactly full", async () => {
    // The classic off-by-one: a table with exactly 500 rows is indistinguishable
    // from a truncated one, so the loop must probe once more.
    const full = Array.from({ length: 500 }, (_, i) => ({
      id: `p${i}`,
      key: `k${i}`,
      name: "n",
      description: null,
    }));
    model("permission").findMany
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([{ id: "p500", key: "k500", name: "n", description: null }]);

    const rows = await exportPermissions();

    expect(rows).toHaveLength(501);
    expect(model("permission").findMany).toHaveBeenCalledTimes(2);
    expect(model("permission").findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 500, skip: 500 }),
    );
  });

  it("returns everything it read across pages, in page order", async () => {
    const page = (start: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `p${start + i}`,
        key: `k${start + i}`,
        name: "n",
        description: null,
      }));
    model("permission").findMany
      .mockResolvedValueOnce(page(0, 500))
      .mockResolvedValueOnce(page(500, 500))
      .mockResolvedValueOnce(page(1000, 3));

    const rows = await exportPermissions();

    expect(rows).toHaveLength(1003);
    expect(rows[0]?.id).toBe("p0");
    expect(rows[1002]?.id).toBe("p1002");
  });

  it("orders every paged query so the pages do not interleave", async () => {
    await exportStorageNodes("global", null);

    expect(model("storageNode").findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ name: "asc" }, { id: "asc" }] }),
    );
  });
});

describe("exportUserStorageAccess tenant scoping", () => {
  it("filters a team export by member as well as by node", async () => {
    // Node-only filtering would export other teams' users' grants: a team's
    // nodes, and every legacy teamId:null node, carry grants for outsiders.
    await exportUserStorageAccess("team", ["n1", "n2"], ["u1"]);

    expect(model("userStorageAccess").findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { storageNodeId: { in: ["n1", "n2"] }, userId: { in: ["u1"] } },
      }),
    );
  });

  it("returns nothing without a node or without a member, rather than everything", async () => {
    expect(await exportUserStorageAccess("team", [], ["u1"])).toEqual([]);
    expect(await exportUserStorageAccess("team", ["n1"], [])).toEqual([]);
    expect(model("userStorageAccess").findMany).not.toHaveBeenCalled();
  });

  it("reads the whole table unfiltered on a global export", async () => {
    await exportUserStorageAccess("global", [], []);

    expect(model("userStorageAccess").findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ where: expect.anything() }),
    );
  });

  it("serializes quotas as decimal strings so JSON keeps the exact value", async () => {
    model("userStorageAccess").findMany.mockResolvedValueOnce([
      {
        id: "a1",
        userId: "u1",
        storageNodeId: "n1",
        pathPrefix: "/",
        canRead: true,
        canWrite: true,
        canDelete: false,
        quotaBytes: BigInt("10737418240"),
        maxFileBytes: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);

    const rows = await exportUserStorageAccess("global", [], []);

    expect(rows[0]?.quotaBytes).toBe("10737418240");
    expect(rows[0]?.maxFileBytes).toBeNull();
    expect(rows[0]?.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("team scope leaves platform-wide tables out entirely", () => {
  it("exports no settings, providers or announcements for a team", async () => {
    expect(await exportSettings("full", "team")).toEqual([]);
    expect(await exportAiProviders("full", "team")).toEqual([]);
    expect(await exportAnnouncements("team")).toEqual([]);

    expect(model("setting").findMany).not.toHaveBeenCalled();
    expect(model("aiProvider").findMany).not.toHaveBeenCalled();
    expect(model("announcement").findMany).not.toHaveBeenCalled();
  });

  it("exports nothing user-derived when the team has no members", async () => {
    expect(await exportUserRoles("team", [])).toEqual([]);
    expect(await exportSnippets("team", [])).toEqual([]);

    expect(model("userRole").findMany).not.toHaveBeenCalled();
    expect(model("snippet").findMany).not.toHaveBeenCalled();
  });

  it("keeps hub-host services but only this team's remote services", async () => {
    await exportQuickServices("standard", "team", "team_a");

    expect(model("quickService").findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ serverId: null }, { server: { teamId: "team_a" } }] },
      }),
    );
  });

  it("includes legacy shared rows in a team export of an owned table", async () => {
    // teamId: null is the project's legacy-shared marker, not another tenant.
    await exportStorageNodes("team", "team_a");

    expect(model("storageNode").findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ teamId: "team_a" }, { teamId: null }] } }),
    );
  });
});

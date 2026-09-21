// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({ raw: vi.fn(), findMany: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/auth/team-scope", () => ({ isGlobalTeamManager: () => false, serverTeamWhere: () => ({ teamId: "team-a" }) }));
vi.mock("../service-internals", () => ({ enrichServer: (row: unknown) => row }));
vi.mock("../service-profile-includes", () => ({ SERVER_PROFILE_INCLUDE: {} }));
vi.mock("../availability", () => ({ getServerTargetAvailability: vi.fn() }));
import { getServerInventory, normalizeInventoryQuery } from "../inventory";

const session = { userId: "user-a", roles: ["viewer"] as ["viewer"], currentTeamId: "team-a" };
describe("inventory operating-system filtering before pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback({ $queryRaw: mocks.raw, server: { findMany: mocks.findMany } }));
    mocks.findMany.mockResolvedValue([]);
  });
  it("normalizes only supported operating systems", () => {
    for (const operatingSystem of ["WINDOWS", "LINUX", "all"]) expect(normalizeInventoryQuery({ operatingSystem }).operatingSystem).toBe(operatingSystem);
    for (const operatingSystem of [undefined, "windows", "FREEBSD", ["WINDOWS"]]) expect(normalizeInventoryQuery({ operatingSystem }).operatingSystem).toBe("all");
  });
  it.each(["WINDOWS", "LINUX"])("binds %s in both matching count and paginated selection", async (operatingSystem) => {
    mocks.raw.mockResolvedValueOnce([{ total: 40, matching: 13, enabled: 30, storage: 0 }]).mockResolvedValueOnce([{ id: "last-matching-server" }]);
    await getServerInventory(session, { operatingSystem, page: 2, status: "enabled", mode: "DIRECT", query: "fixture" });
    const count = mocks.raw.mock.calls[0]![0] as Prisma.Sql;
    const selection = mocks.raw.mock.calls[1]![0] as Prisma.Sql;
    expect(count.sql).toMatch(/count\(\*\) FILTER \(WHERE [\s\S]*s\."operatingSystem"::text = \?\)::int AS matching/);
    expect(selection.sql).toMatch(/WHERE [\s\S]*s\."operatingSystem"::text = \?[\s\S]*ORDER BY[\s\S]*LIMIT \? OFFSET \?/);
    for (const sql of [count, selection]) expect(sql.values).toEqual(expect.arrayContaining([operatingSystem, "team-a", true, "DIRECT", "%fixture%"]));
    expect(selection.values.slice(-2)).toEqual([12, 12]);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ teamId: "team-a" }, { id: { in: ["last-matching-server"] } }] } }));
  });
  it("clamps against OS matching count, not all-server count", async () => {
    mocks.raw.mockResolvedValueOnce([{ total: 100, matching: 13, enabled: 80, storage: 0 }]).mockResolvedValueOnce([]);
    const result = await getServerInventory(session, { operatingSystem: "WINDOWS", page: 999 });
    expect(result.query.page).toBe(2);
    expect(result.stats.matching).toBe(13);
    expect((mocks.raw.mock.calls[1]![0] as Prisma.Sql).values.slice(-2)).toEqual([12, 12]);
  });
  it("returns empty OS results at page one without hydrating unrelated servers", async () => {
    mocks.raw.mockResolvedValueOnce([{ total: 100, matching: 0, enabled: 80, storage: 0 }]).mockResolvedValueOnce([]);
    const result = await getServerInventory(session, { operatingSystem: "WINDOWS", page: 999 });
    expect(result.query.page).toBe(1);
    expect(result.servers).toEqual([]);
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect((mocks.raw.mock.calls[1]![0] as Prisma.Sql).values.slice(-2)).toEqual([12, 0]);
  });
  it("does not constrain OS when all is selected", async () => {
    mocks.raw.mockResolvedValueOnce([{ total: 40, matching: 40, enabled: 30, storage: 0 }]).mockResolvedValueOnce([]);
    await getServerInventory(session, { operatingSystem: "all" });
    for (const [sql] of mocks.raw.mock.calls) expect((sql as Prisma.Sql).sql).not.toContain('"operatingSystem"');
  });
});

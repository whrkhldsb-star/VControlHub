import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ count: vi.fn(), findMany: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/auth/team-scope", () => ({ teamWhere: () => ({ teamId: "team-a" }) }));
import { getRecycleBinPage, recycleBinQuerySchema } from "../recycle-bin";
const session: Parameters<typeof getRecycleBinPage>[0] = { userId: "viewer", roles: ["viewer"], currentTeamId: "team-a" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.count.mockResolvedValue(1208);
  mocks.findMany.mockResolvedValue([{ id: "last-deleted-file" }]);
  mocks.transaction.mockImplementation((callback) => callback({ fileEntry: { count: mocks.count, findMany: mocks.findMany } }));
});

describe("Recycle bin pagination", () => {
  it("applies the same tenant and tombstone filter to counts and page rows", async () => {
    const result = await getRecycleBinPage(session, { page: 25, pageSize: 50 });
    expect(mocks.count).toHaveBeenCalledWith({ where: { isDeleted: true, storageNode: { teamId: "team-a" } } });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isDeleted: true, storageNode: { teamId: "team-a" } }, skip: 1200, take: 50,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    }));
    expect(result.pagination).toEqual({ page: 25, pageSize: 50, totalItems: 1208, totalPages: 25 });
  });
  it("clamps a deleted last page using the count from the same snapshot", async () => {
    mocks.count.mockResolvedValue(50);
    const result = await getRecycleBinPage(session, { page: 2, pageSize: 50 });
    expect(result.pagination.page).toBe(1);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
  });
  it("normalizes invalid URL paging values", () => {
    expect(recycleBinQuerySchema.parse({ page: "-1", pageSize: "100000" })).toEqual({ page: 1, pageSize: 50 });
    expect(recycleBinQuerySchema.parse({ page: "2", pageSize: "100" })).toEqual({ page: 2, pageSize: 100 });
  });
});

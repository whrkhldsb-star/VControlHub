import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
  transaction: vi.fn(),
  nodeFindMany: vi.fn(),
  grantFindMany: vi.fn(),
  hasPermission: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    storageNode: { findMany: mocks.nodeFindMany },
    userStorageAccess: { findMany: mocks.grantFindMany },
  },
}));
vi.mock("@/lib/auth/team-scope", () => ({ teamWhere: () => ({ teamId: "team-a" }) }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: mocks.hasPermission }));
vi.mock("@/lib/storage/path-utils", () => ({
  normalizeStorageTargetDirectory: (value: string) => ({ ok: true, path: value }),
}));
import { getRecycleBinPage, recycleBinQuerySchema } from "../recycle-bin";
const session: Parameters<typeof getRecycleBinPage>[0] = {
  userId: "viewer",
  roles: ["viewer"],
  currentTeamId: "team-a",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.count.mockResolvedValue(1208);
  mocks.findMany.mockResolvedValue([{ id: "last-deleted-file" }]);
  mocks.transaction.mockImplementation((callback) =>
    callback({ fileEntry: { count: mocks.count, findMany: mocks.findMany } }),
  );
  // Default: viewer without storage:manage-node and with a full-node read
  // grant, so the recycle-bin where keeps the plain tenant + tombstone shape.
  mocks.hasPermission.mockReturnValue(false);
  mocks.nodeFindMany.mockResolvedValue([{ id: "node-1" }]);
  mocks.grantFindMany.mockResolvedValue([
    { id: "g1", storageNodeId: "node-1", pathPrefix: "", canRead: true },
  ]);
});

describe("Recycle bin pagination", () => {
  it("applies the same tenant and tombstone filter to counts and page rows", async () => {
    const result = await getRecycleBinPage(session, { page: 25, pageSize: 50 });
    expect(mocks.count).toHaveBeenCalledWith({
      where: {
        isDeleted: true,
        storageNode: { teamId: "team-a" },
        OR: [{ storageNodeId: "node-1" }],
      },
    });
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isDeleted: true,
          storageNode: { teamId: "team-a" },
          OR: [{ storageNodeId: "node-1" }],
        },
        skip: 1200,
        take: 50,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      }),
    );
    expect(result.pagination).toEqual({ page: 25, pageSize: 50, totalItems: 1208, totalPages: 25 });
  });
  it("clamps a deleted last page using the count from the same snapshot", async () => {
    mocks.count.mockResolvedValue(50);
    const result = await getRecycleBinPage(session, { page: 2, pageSize: 50 });
    expect(result.pagination.page).toBe(1);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
    });
  });
  it("keeps the unfiltered listing for storage managers", async () => {
    mocks.hasPermission.mockReturnValue(true);
    await getRecycleBinPage(session, { page: 1, pageSize: 50 });
    expect(mocks.count).toHaveBeenCalledWith({
      where: { isDeleted: true, storageNode: { teamId: "team-a" } },
    });
  });
  it("filters entries down to granted path prefixes for restricted viewers", async () => {
    mocks.grantFindMany.mockResolvedValue([
      { id: "g1", storageNodeId: "node-1", pathPrefix: "docs", canRead: true },
      { id: "g2", storageNodeId: "node-1", pathPrefix: "secret", canRead: false },
    ]);
    await getRecycleBinPage(session, { page: 1, pageSize: 50 });
    expect(mocks.count).toHaveBeenCalledWith({
      where: {
        isDeleted: true,
        storageNode: { teamId: "team-a" },
        OR: [
          {
            storageNodeId: "node-1",
            OR: [
              { relativePath: "docs" },
              { relativePath: { startsWith: "docs/" } },
            ],
          },
        ],
      },
    });
  });
  it("matches no rows when the user holds no readable nodes", async () => {
    mocks.grantFindMany.mockResolvedValue([]);
    await getRecycleBinPage(session, { page: 1, pageSize: 50 });
    expect(mocks.count).toHaveBeenCalledWith({
      where: {
        isDeleted: true,
        storageNode: { teamId: "team-a" },
        id: "",
      },
    });
  });
  it("normalizes invalid URL paging values", () => {
    expect(recycleBinQuerySchema.parse({ page: "-1", pageSize: "100000" })).toEqual({
      page: 1,
      pageSize: 50,
    });
    expect(recycleBinQuerySchema.parse({ page: "2", pageSize: "100" })).toEqual({
      page: 2,
      pageSize: 100,
    });
  });
});

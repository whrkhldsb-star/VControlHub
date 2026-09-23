import { describe, expect, it, vi, beforeEach } from "vitest";
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    fileEntry: { findMany: vi.fn() },
    mediaItem: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
const {
  classifyMedia,
  scanMediaFromFileEntries,
  listMediaItems,
  listMediaTypeCounts,
  getMediaItem,
} = await import("./service");
describe("media service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.mediaItem.findMany.mockResolvedValue([]);
    mockPrisma.mediaItem.deleteMany.mockResolvedValue({ count: 0 });
  });
  it("classifies images and videos only", () => {
    expect(classifyMedia("image/png")).toBe("image");
    expect(classifyMedia("video/mp4")).toBe("video");
    expect(classifyMedia("text/plain")).toBeNull();
  });
  it("upserts media metadata from file entries", async () => {
    mockPrisma.fileEntry.findMany
      .mockResolvedValueOnce([
        {
          id: "f1",
          name: "a.png",
          relativePath: "a.png",
          storageNodeId: "n1",
          mimeType: "image/png",
          size: BigInt(5),
        },
      ])
      .mockResolvedValueOnce([]);
    mockPrisma.mediaItem.upsert.mockResolvedValue({});
    const res = await scanMediaFromFileEntries("u1");
    expect(res).toEqual({ scanned: 1, upserted: 1, removed: 0 });
    expect(mockPrisma.mediaItem.upsert.mock.calls[0]![0].create.mediaType).toBe(
      "image",
    );
  });

  it("upserts mp4 media even when the persisted MIME is generic", async () => {
    mockPrisma.fileEntry.findMany
      .mockResolvedValueOnce([
        {
          id: "f_mp4",
          name: "movie.mp4",
          relativePath: "uploads/movie.mp4",
          storageNodeId: "n1",
          mimeType: "application/octet-stream",
          size: BigInt(99),
        },
      ])
      .mockResolvedValueOnce([]);
    mockPrisma.mediaItem.upsert.mockResolvedValue({});

    const res = await scanMediaFromFileEntries("u1");

    expect(res).toEqual({ scanned: 1, upserted: 1, removed: 0 });
    expect(mockPrisma.mediaItem.upsert.mock.calls[0]![0].create).toMatchObject({
      fileEntryId: "f_mp4",
      mediaType: "video",
      mimeType: "video/mp4",
      relativePath: "uploads/movie.mp4",
    });
  });

  it("removes media rows linked to deleted or non-file entries during rescan", async () => {
    mockPrisma.fileEntry.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "deleted_file" }, { id: "folder_entry" }]);
    mockPrisma.mediaItem.deleteMany.mockResolvedValue({ count: 2 });

    const res = await scanMediaFromFileEntries("u1");

    expect(res).toEqual({ scanned: 0, upserted: 0, removed: 2 });
    expect(mockPrisma.fileEntry.findMany.mock.calls[1]![0]).toMatchObject({
      where: {
        OR: [{ isDeleted: true }, { entryType: { not: "FILE" } }],
      },
      select: { id: true },
    });
    expect(mockPrisma.mediaItem.deleteMany).toHaveBeenCalledWith({
      where: { fileEntryId: { in: ["deleted_file", "folder_entry"] } },
    });
  });

  it("scans past the first 1000 entries with deterministic cursor pagination", async () => {
    // Regression: a bare take:1000 with no orderBy re-read the same arbitrary
    // page forever, so media libraries over 1000 files were never fully scanned.
    const makeEntry = (index: number) => ({
      id: `f${index}`,
      name: `a${index}.png`,
      relativePath: `a${index}.png`,
      storageNodeId: "n1",
      mimeType: "image/png",
      size: BigInt(1),
      updatedAt: new Date(index),
    });
    const fullPage = Array.from({ length: 1000 }, (_, index) => makeEntry(index));
    const tail = [makeEntry(1000)];
    mockPrisma.fileEntry.findMany
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce(tail)
      .mockResolvedValueOnce([]) // stale page 1 (empty → loop ends)
      .mockResolvedValue([]);
    mockPrisma.mediaItem.upsert.mockResolvedValue({});

    const res = await scanMediaFromFileEntries("u1");

    expect(res.scanned).toBe(1001);
    // Every scan page must be deterministically ordered and follow the cursor.
    const scanCalls = mockPrisma.fileEntry.findMany.mock.calls.slice(0, 2);
    for (const [arg] of scanCalls) {
      expect(arg.orderBy).toEqual([{ updatedAt: "asc" }, { id: "asc" }]);
    }
    expect(scanCalls[1]![0]).toMatchObject({
      cursor: { id: "f999" },
      skip: 1,
    });
    // The stale cleanup shares the same ordering discipline.
    expect(mockPrisma.fileEntry.findMany.mock.calls[2]![0].orderBy).toEqual([
      { updatedAt: "asc" },
      { id: "asc" },
    ]);
  });

  it("builds a practical image search across name, path and tags", async () => {
    mockPrisma.mediaItem.findMany.mockResolvedValue([]);

    await listMediaItems({
      mediaType: "image",
      q: "summer",
      favorite: true,
      tag: "cover",
    });

    expect(mockPrisma.mediaItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          mediaType: "image",
          favorite: true,
          tags: { has: "cover" },
          OR: [
            { name: { contains: "summer", mode: "insensitive" } },
            { relativePath: { contains: "summer", mode: "insensitive" } },
            { tags: { has: "summer" } },
          ],
        }),
      }),
    );
  });

  it("counts media types across the current non-type filters", async () => {
    mockPrisma.mediaItem.groupBy.mockResolvedValue([
      { mediaType: "image", _count: { _all: 3 } },
      { mediaType: "audio", _count: { _all: 2 } },
    ]);

    const counts = await listMediaTypeCounts({
      q: "summer",
      favorite: true,
      tag: "cover",
    });

    expect(counts).toEqual({ image: 3, video: 0, audio: 2 });
    expect(mockPrisma.mediaItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["mediaType"],
        where: expect.objectContaining({
          favorite: true,
          tags: { has: "cover" },
          OR: [
            { name: { contains: "summer", mode: "insensitive" } },
            { relativePath: { contains: "summer", mode: "insensitive" } },
            { tags: { has: "summer" } },
          ],
        }),
        _count: { _all: true },
      }),
    );
  });

  it("counts media types across the current non-type filters", async () => {
    mockPrisma.mediaItem.groupBy.mockResolvedValue([
      { mediaType: "image", _count: { _all: 3 } },
      { mediaType: "audio", _count: { _all: 2 } },
    ]);

    const counts = await listMediaTypeCounts({
      q: "summer",
      favorite: true,
      tag: "cover",
    });

    expect(counts).toEqual({ image: 3, video: 0, audio: 2 });
    expect(mockPrisma.mediaItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["mediaType"],
        where: expect.objectContaining({
          favorite: true,
          tags: { has: "cover" },
          OR: [
            { name: { contains: "summer", mode: "insensitive" } },
            { relativePath: { contains: "summer", mode: "insensitive" } },
            { tags: { has: "summer" } },
          ],
        }),
        _count: { _all: true },
      }),
    );
  });

  it("keeps media list queries free of SFTP secrets", async () => {
    mockPrisma.mediaItem.findMany.mockResolvedValue([]);

    await listMediaItems();

    const select = mockPrisma.mediaItem.findMany.mock.calls[0]![0].select;
    expect(select.storageNode.select.server.select).toEqual({
      id: true,
      name: true,
      host: true,
    });
  });

  it("selects connection credentials only when includeCredentials is requested", async () => {
    mockPrisma.mediaItem.findFirst.mockResolvedValue(null);

    await getMediaItem("media_1");
    expect(mockPrisma.mediaItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "media_1" },
        select: expect.objectContaining({
          storageNode: expect.objectContaining({
            select: expect.objectContaining({
              server: {
                select: {
                  id: true,
                  name: true,
                  host: true,
                },
              },
            }),
          }),
        }),
      }),
    );

    mockPrisma.mediaItem.findFirst.mockClear();
    await getMediaItem("media_1", undefined, { includeCredentials: true });
    expect(mockPrisma.mediaItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "media_1" },
        select: expect.objectContaining({
          storageNode: expect.objectContaining({
            select: expect.objectContaining({
              server: {
                select: expect.objectContaining({
                  connectionType: true,
                  password: true,
                  sshKey: { select: { privateKey: true } },
                }),
              },
            }),
          }),
        }),
      }),
    );
  });

  it("scopes media list by storageNode.teamId when session has currentTeamId", async () => {
    mockPrisma.mediaItem.findMany.mockResolvedValueOnce([]);
    await listMediaItems({
      session: { userId: "u1", roles: ["operator"], currentTeamId: "team_a" },
    });
    expect(mockPrisma.mediaItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          storageNode: {
            OR: [{ teamId: "team_a" }, { teamId: null }],
          },
        }),
      }),
    );
  });

  it("getMediaItem uses findFirst with team scope", async () => {
    mockPrisma.mediaItem.findFirst = vi.fn().mockResolvedValueOnce(null);
    await getMediaItem("m1", {
      userId: "u1",
      roles: ["operator"],
      currentTeamId: "team_a",
    });
    expect(mockPrisma.mediaItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "m1",
          storageNode: {
            OR: [{ teamId: "team_a" }, { teamId: null }],
          },
        }),
      }),
    );
  });
});

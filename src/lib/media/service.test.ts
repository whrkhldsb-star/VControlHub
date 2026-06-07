import { describe, expect, it, vi, beforeEach } from "vitest";
const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: { fileEntry: { findMany: vi.fn() }, mediaItem: { upsert: vi.fn(), findMany: vi.fn(), update: vi.fn(), groupBy: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
const { classifyMedia, scanMediaFromFileEntries, listMediaItems, listMediaTypeCounts } = await import("./service");
describe("media service", () => {
  beforeEach(() => vi.clearAllMocks());
  it("classifies images and videos only", () => { expect(classifyMedia("image/png")).toBe("image"); expect(classifyMedia("video/mp4")).toBe("video"); expect(classifyMedia("text/plain")).toBeNull(); });
  it("upserts media metadata from file entries", async () => {
    mockPrisma.fileEntry.findMany.mockResolvedValue([{ id: "f1", name: "a.png", relativePath: "a.png", storageNodeId: "n1", mimeType: "image/png", size: BigInt(5) }]);
    mockPrisma.mediaItem.upsert.mockResolvedValue({});
    const res = await scanMediaFromFileEntries("u1");
    expect(res.upserted).toBe(1);
    expect(mockPrisma.mediaItem.upsert.mock.calls[0][0].create.mediaType).toBe("image");
  });

  it("upserts mp4 media even when the persisted MIME is generic", async () => {
    mockPrisma.fileEntry.findMany.mockResolvedValue([
      {
        id: "f_mp4",
        name: "movie.mp4",
        relativePath: "uploads/movie.mp4",
        storageNodeId: "n1",
        mimeType: "application/octet-stream",
        size: BigInt(99),
      },
    ]);
    mockPrisma.mediaItem.upsert.mockResolvedValue({});

    const res = await scanMediaFromFileEntries("u1");

    expect(res).toEqual({ scanned: 1, upserted: 1 });
    expect(mockPrisma.mediaItem.upsert.mock.calls[0][0].create).toMatchObject({
      fileEntryId: "f_mp4",
      mediaType: "video",
      mimeType: "video/mp4",
      relativePath: "uploads/movie.mp4",
    });
  });

  it("builds a practical image search across name, path and tags", async () => {
    mockPrisma.mediaItem.findMany.mockResolvedValue([]);

    await listMediaItems({ mediaType: "image", q: "summer", favorite: true, tag: "cover" });

    expect(mockPrisma.mediaItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
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
    }));
  });

  it("counts media types across the current non-type filters", async () => {
    mockPrisma.mediaItem.groupBy.mockResolvedValue([
      { mediaType: "image", _count: { _all: 3 } },
      { mediaType: "audio", _count: { _all: 2 } },
    ]);

    const counts = await listMediaTypeCounts({ q: "summer", favorite: true, tag: "cover" });

    expect(counts).toEqual({ image: 3, video: 0, audio: 2 });
    expect(mockPrisma.mediaItem.groupBy).toHaveBeenCalledWith(expect.objectContaining({
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
    }));
  });
});

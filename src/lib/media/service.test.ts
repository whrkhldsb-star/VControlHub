import { describe, expect, it, vi, beforeEach } from "vitest";
const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: { fileEntry: { findMany: vi.fn() }, mediaItem: { upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
const { classifyMedia, scanMediaFromFileEntries } = await import("./service");
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
});

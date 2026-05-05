import { describe, expect, it, vi } from "vitest";
const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: { announcement: { create: vi.fn(), findMany: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
const { listActiveAnnouncements } = await import("./service");
describe("announcement service", () => {
  it("lists only active announcements ordered pinned first", async () => {
    const now = new Date("2026-05-05T00:00:00Z");
    mockPrisma.announcement.findMany.mockResolvedValue([]);
    await listActiveAnnouncements(now);
    expect(mockPrisma.announcement.findMany.mock.calls[0][0]).toMatchObject({ where: { published: true, startsAt: { lte: now } }, orderBy: [{ pinned: "desc" }, { startsAt: "desc" }] });
  });
});

/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, assertStorageAccess } = vi.hoisted(() => ({
  mockPrisma: {
    shareLink: { create: vi.fn() },
    fileEntry: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  assertStorageAccess: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/storage/access-control", () => ({ assertStorageAccess, releaseStorageQuotaGuard: vi.fn(async () => undefined) }));

const { createShareLinksFromFileEntries } = await import("../service");
const { SHARE_BATCH_MAX } = await import("../policy");

const administrator = { userId: "admin_1", username: "root", roles: ["admin" as const], mustChangePassword: false, currentTeamId: null };
const entry = (id: string, name: string, storageNodeId: string, teamId: string | null) => ({
  id,
  name,
  relativePath: `docs/${name}`,
  entryType: "FILE",
  storageNodeId,
  storageNode: { teamId },
});

beforeEach(() => {
  vi.clearAllMocks();
  assertStorageAccess.mockResolvedValue({ allowed: true });
  mockPrisma.shareLink.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: `share_${String(data.path)}`, ...data, createdAt: new Date(), updatedAt: new Date() }));
  mockPrisma.$transaction.mockImplementation(async (operations: Array<Promise<unknown>>) => Promise.all(operations));
});

// Several files selected in the drive: one link each, made by one request.
describe("sharing several files at once", () => {
  it("makes one link per file in the order asked, each with its node's customer, in one transaction", async () => {
    mockPrisma.fileEntry.findMany.mockResolvedValue([entry("f2", "b.pdf", "node_b", null), entry("f1", "a.pdf", "node_a", "team_a")]);

    const created = await createShareLinksFromFileEntries({ session: administrator, fileEntryIds: ["f1", "f2", "f1"], expiresInHours: 24 });

    expect(created.map((item) => [item.fileEntryId, item.share.name, item.share.path, item.share.teamId])).toEqual([
      ["f1", "a.pdf", "docs/a.pdf", "team_a"],
      ["f2", "b.pdf", "docs/b.pdf", null],
    ]);
    expect(new Set(created.map((item) => item.token)).size).toBe(2);
    expect(created.every((item) => item.token.length === 48)).toBe(true);
    // Neither the stored hash of the token nor of the password leaves the service.
    expect(created[0]!.share).not.toHaveProperty("tokenHash");
    expect(created[0]!.share).not.toHaveProperty("passwordHash");
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.fileEntry.findMany.mock.calls[0]![0].where).toMatchObject({ id: { in: ["f1", "f2"] }, isDeleted: false });
    const expiry = (mockPrisma.shareLink.create.mock.calls[0]![0].data.expiresAt as Date).getTime() - Date.now();
    expect(Math.abs(expiry - 24 * 3_600_000)).toBeLessThan(5_000);
  });

  // A link made before the refusal would be live with its token known to nobody.
  it("makes none when one of the files is gone or not the caller's to see", async () => {
    mockPrisma.fileEntry.findMany.mockResolvedValue([entry("f1", "a.pdf", "node_a", "team_a")]);

    await expect(createShareLinksFromFileEntries({ session: administrator, fileEntryIds: ["f1", "f_missing"] })).rejects.toMatchObject({ status: 404 });
    expect(mockPrisma.shareLink.create).not.toHaveBeenCalled();
  });

  it("makes none when one of the files is outside the caller's path grants", async () => {
    mockPrisma.fileEntry.findMany.mockResolvedValue([entry("f1", "a.pdf", "node_a", "team_a"), entry("f2", "b.pdf", "node_a", "team_a")]);
    assertStorageAccess.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false, reason: "no_access" });

    await expect(createShareLinksFromFileEntries({ session: administrator, fileEntryIds: ["f1", "f2"] })).rejects.toMatchObject({ status: 403 });
    expect(mockPrisma.shareLink.create).not.toHaveBeenCalled();
    expect(assertStorageAccess).toHaveBeenCalledWith(expect.objectContaining({ storageNodeId: "node_a", relativePath: "docs/b.pdf", operation: "read" }));
  });

  it("gives every link the same policy and hashes a password once", async () => {
    mockPrisma.fileEntry.findMany.mockResolvedValue([entry("f1", "a.pdf", "node_a", "team_a"), entry("f2", "b.pdf", "node_a", "team_a")]);

    await createShareLinksFromFileEntries({ session: administrator, fileEntryIds: ["f1", "f2"], password: "s3cret", maxDownloads: 3 });

    const rows = mockPrisma.shareLink.create.mock.calls.map(([call]) => call.data);
    expect(rows.map((row) => [row.maxDownloads, row.permissionLevel, row.createdBy])).toEqual([[3, "download", "admin_1"], [3, "download", "admin_1"]]);
    expect(rows[0].passwordHash).toMatch(/^scrypt:/);
    expect(rows[1].passwordHash).toBe(rows[0].passwordHash);
  });

  it("refuses an empty request, more files than one request may share, and controls a preview-only link cannot have", async () => {
    await expect(createShareLinksFromFileEntries({ session: administrator, fileEntryIds: [] })).rejects.toMatchObject({ status: 400 });
    const tooMany = Array.from({ length: SHARE_BATCH_MAX + 1 }, (_, index) => `f${index}`);
    await expect(createShareLinksFromFileEntries({ session: administrator, fileEntryIds: tooMany })).rejects.toMatchObject({ status: 400 });
    await expect(createShareLinksFromFileEntries({ session: administrator, fileEntryIds: ["f1"], permissionLevel: "preview", password: "x" })).rejects.toMatchObject({ status: 400 });
    expect(mockPrisma.fileEntry.findMany).not.toHaveBeenCalled();
  });
});

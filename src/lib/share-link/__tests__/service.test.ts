import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    shareLink: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: vi.fn(async () => ({ allowed: true })),
}));

const { createShareLink, listShareLinks, normalizeSharePath, resolveShareToken } = await import("../service");

describe("share link service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a share token but stores only its hash", async () => {
    mockPrisma.shareLink.create.mockImplementation(async ({ data }: any) => ({ id: "share1", ...data, createdAt: new Date(), updatedAt: new Date() }));

    const result = await createShareLink({
      session: { userId: "u1", username: "alice", roles: ["storage_manager"], mustChangePassword: false, currentTeamId: null },
      storageNodeId: "node1",
      path: "docs/report.pdf",
      entryType: "FILE",
      expiresInHours: 24,
    });

    expect(result.token).toHaveLength(48);
    expect(mockPrisma.shareLink.create.mock.calls[0]![0]!.data.tokenHash).not.toBe(result.token);
    expect(mockPrisma.shareLink.create.mock.calls[0]![0]!.data.path).toBe("docs/report.pdf");
  });

  it("bounds share-link list hydration for growing public-link history", async () => {
    mockPrisma.shareLink.findMany.mockResolvedValueOnce([]);

    await listShareLinks();

    expect(mockPrisma.shareLink.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { createdAt: "desc" },
      take: 200,
    }));
  });

  it("normalizes share paths and rejects traversal or unsafe absolute paths", () => {
    expect(normalizeSharePath("/docs//report.pdf")).toBe("docs/report.pdf");
    expect(normalizeSharePath("docs\\nested\\report.pdf")).toBe("docs/nested/report.pdf");
    expect(() => normalizeSharePath("../secret.txt")).toThrow(/安全相对路径/);
    expect(() => normalizeSharePath("docs/../../secret.txt")).toThrow(/安全相对路径/);
    expect(() => normalizeSharePath("C:\\secret.txt")).toThrow(/安全相对路径/);
    expect(() => normalizeSharePath("//server/share.txt")).toThrow(/安全相对路径/);
    expect(() => normalizeSharePath("docs/\u0000secret.txt")).toThrow(/安全相对路径/);
  });

  it("rejects expired public share tokens", async () => {
    mockPrisma.shareLink.findUnique.mockResolvedValue({ id: "share1", tokenHash: "x", expiresAt: new Date("2020-01-01T00:00:00Z"), revokedAt: null });
    await expect(resolveShareToken("abc")).rejects.toThrow(/has expired/);
  });

  it("rejects password-protected shares when no password provided", async () => {
    const { hashSharePassword } = await import("../service");
    mockPrisma.shareLink.findUnique.mockResolvedValue({ id: "share1", tokenHash: "x", expiresAt: null, revokedAt: null, maxDownloads: null, accessCount: 0, passwordHash: hashSharePassword("s3cret") });
    await expect(resolveShareToken("abc")).rejects.toThrow(/requires a password/);
  });

  it("rejects password-protected shares with wrong password", async () => {
    const { hashSharePassword } = await import("../service");
    mockPrisma.shareLink.findUnique.mockResolvedValue({ id: "share1", tokenHash: "x", expiresAt: null, revokedAt: null, maxDownloads: null, accessCount: 0, passwordHash: hashSharePassword("s3cret") });
    await expect(resolveShareToken("abc", "wrong")).rejects.toThrow(/Incorrect access password/);
  });

  it("allows password-protected shares with correct password", async () => {
    const { hashSharePassword } = await import("../service");
    mockPrisma.shareLink.findUnique.mockResolvedValue({ id: "share1", tokenHash: "x", expiresAt: null, revokedAt: null, maxDownloads: null, accessCount: 0, passwordHash: hashSharePassword("s3cret") });
    mockPrisma.shareLink.update.mockResolvedValue({ id: "share1" });
    const result = await resolveShareToken("abc", "s3cret");
    expect(result.id).toBe("share1");
    expect(mockPrisma.shareLink.update).toHaveBeenCalled();
  });

  it("accepts legacy SHA-256 share passwords and upgrades them to scrypt", async () => {
    const { hashSharePasswordLegacySha256 } = await import("../service");
    const legacyHash = hashSharePasswordLegacySha256("legacy-pass");
    mockPrisma.shareLink.findUnique.mockResolvedValue({
      id: "share-legacy",
      tokenHash: "x",
      expiresAt: null,
      revokedAt: null,
      maxDownloads: null,
      accessCount: 0,
      passwordHash: legacyHash,
    });
    mockPrisma.shareLink.update.mockResolvedValue({ id: "share-legacy" });
    mockPrisma.shareLink.updateMany.mockResolvedValue({ count: 1 });

    const result = await resolveShareToken("abc", "legacy-pass");
    expect(result.id).toBe("share-legacy");
    expect(mockPrisma.shareLink.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "share-legacy", passwordHash: legacyHash },
        data: { passwordHash: expect.stringMatching(/^scrypt:/) },
      }),
    );
  });
});

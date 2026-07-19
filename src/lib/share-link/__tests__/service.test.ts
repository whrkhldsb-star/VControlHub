/** @vitest-environment node */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    shareLink: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    shareAccessLog: { create: vi.fn() },
    fileEntry: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth/team-scope", () => ({
  teamWhere: (session: { currentTeamId?: string | null }) =>
    session.currentTeamId
      ? { OR: [{ teamId: session.currentTeamId }, { teamId: null }] }
      : {},
  teamCreateData: (session: { currentTeamId?: string | null }) => ({
    teamId: session.currentTeamId ?? null,
  }),
}));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: vi.fn(async () => ({ allowed: true })),
}));

const { createShareLink, createShareLinkFromFileEntry, listShareLinks, normalizeSharePath, resolveShareToken, revokeShareLink } = await import("../service");

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
    mockPrisma.shareAccessLog.create.mockResolvedValue({ id: "log1" });
    const result = await resolveShareToken("abc", "s3cret");
    expect(result.id).toBe("share1");
    expect(mockPrisma.shareLink.update).toHaveBeenCalled();
    expect(mockPrisma.shareAccessLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shareLinkId: "share1", action: "download" }),
      }),
    );
  });

  it("records view access logs for peekShareToken without incrementing download count", async () => {
    const { peekShareToken } = await import("../service");
    mockPrisma.shareLink.findUnique.mockResolvedValue({
      id: "share-view",
      tokenHash: "x",
      expiresAt: null,
      revokedAt: null,
      passwordHash: null,
      permissionLevel: "download",
      storageNode: { id: "node1" },
    });
    mockPrisma.shareAccessLog.create.mockResolvedValue({ id: "log-view" });
    const result = await peekShareToken("abc", { ip: "203.0.113.9", userAgent: "vitest" });
    expect(result.id).toBe("share-view");
    expect(mockPrisma.shareLink.update).not.toHaveBeenCalled();
    expect(mockPrisma.shareAccessLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shareLinkId: "share-view",
          action: "view",
          ip: "203.0.113.9",
          userAgent: "vitest",
        }),
      }),
    );
  });

  it("rejects legacy or malformed password hashes after the migration window", async () => {
    mockPrisma.shareLink.findUnique.mockResolvedValue({
      id: "share-legacy",
      tokenHash: "x",
      expiresAt: null,
      revokedAt: null,
      maxDownloads: null,
      accessCount: 0,
      passwordHash: "a".repeat(64),
    });
    await expect(resolveShareToken("abc", "legacy-pass")).rejects.toThrow(/Incorrect access password/);
  });

  it("rejects file entries outside team scope when creating from fileEntryId", async () => {
    mockPrisma.fileEntry.findFirst.mockResolvedValueOnce(null);
    await expect(
      createShareLinkFromFileEntry({
        session: { userId: "u1", username: "alice", roles: ["operator"], mustChangePassword: false, currentTeamId: "team_a" },
        fileEntryId: "file_foreign",
      }),
    ).rejects.toThrow();
    expect(mockPrisma.shareLink.create).not.toHaveBeenCalled();
  });

  it("revokes only shares matching ownership and teamWhere when session provided", async () => {
    mockPrisma.shareLink.findFirst.mockResolvedValueOnce({ id: "share1" });
    mockPrisma.shareLink.update.mockResolvedValueOnce({ id: "share1", revokedAt: new Date() });
    const session = { userId: "u1", roles: ["operator"] as const, currentTeamId: "team_a" };
    await revokeShareLink("share1", "u1", session as any);
    expect(mockPrisma.shareLink.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "share1", createdBy: "u1" }),
      }),
    );
  });
});

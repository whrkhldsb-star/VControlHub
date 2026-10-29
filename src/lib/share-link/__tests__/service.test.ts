/** @vitest-environment node */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    shareLink: { create: vi.fn(), count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    shareAccessLog: { create: vi.fn() },
    fileEntry: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth/team-scope", () => ({
  teamWhere: (session: { currentTeamId?: string | null }) =>
    session.currentTeamId
      ? { teamId: session.currentTeamId }
      : {},
  shareLinkTeamWhere: (session: { currentTeamId?: string | null }) =>
    session.currentTeamId
      ? { teamId: session.currentTeamId }
      : { id: "__unassigned_share_links_require_team_manage__" },
  isGlobalTeamManager: (session: { roles?: string[] }) =>
    Array.isArray(session.roles) && session.roles.includes("admin"),
  teamCreateData: (session: { currentTeamId?: string | null }) => ({
    teamId: session.currentTeamId ?? null,
  }),
}));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: (session: { roles?: string[] }, perm: string) => {
    if (perm === "share:manage") {
      return Array.isArray(session.roles) && (session.roles.includes("admin") || session.roles.includes("storage_manager"));
    }
    return true;
  },
}));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: vi.fn(async () => ({ allowed: true })),
  releaseStorageQuotaGuard: vi.fn(async () => undefined),
}));

const { assertShareTargetNotDeleted, createShareLink, createShareLinkFromFileEntry, listShareLinkPage, normalizeSharePath, releaseShareQuotaClaim, resolveShareToken, revokeShareLink } = await import("../service");

describe("share link service", () => {
  beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.fileEntry.findFirst.mockResolvedValue(null);
  });

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

  it("treats a file as deleted when it or any folder above it is in the trash", async () => {
    mockPrisma.fileEntry.findFirst.mockResolvedValueOnce({ id: "trashed-folder" });
    await expect(assertShareTargetNotDeleted("node1", "docs/old/report.pdf")).rejects.toThrow();
    expect(mockPrisma.fileEntry.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { storageNodeId: "node1", relativePath: { in: ["docs", "docs/old", "docs/old/report.pdf"] }, isDeleted: true },
    }));

    mockPrisma.fileEntry.findFirst.mockResolvedValueOnce(null);
    await expect(assertShareTargetNotDeleted("node1", "docs/report.pdf")).resolves.toBeUndefined();
  });

  it("rejects download-only controls on metadata-only shares", async () => {
    const base: Omit<Parameters<typeof createShareLink>[0], "maxDownloads" | "password"> = {
      session: { userId: "u1", username: "alice", roles: ["storage_manager"], mustChangePassword: false, currentTeamId: null },
      storageNodeId: "node1",
      path: "docs/report.pdf",
      entryType: "FILE" as const,
      permissionLevel: "preview" as const,
    };

    await expect(createShareLink({ ...base, maxDownloads: 1 })).rejects.toThrow();
    await expect(createShareLink({ ...base, password: "secret" })).rejects.toThrow();
    expect(mockPrisma.shareLink.create).not.toHaveBeenCalled();
  });

  it("pages the share list with a stable order, a real total and no secret columns", async () => {
    mockPrisma.shareLink.findMany.mockResolvedValueOnce([]);
    mockPrisma.shareLink.count.mockResolvedValueOnce(205);

    const result = await listShareLinkPage({ userId: "u1", roles: ["operator"], currentTeamId: "team-1" }, { page: 3, pageSize: 50 });

    expect(result).toMatchObject({ total: 205, page: 3, pageSize: 50 });
    const query = mockPrisma.shareLink.findMany.mock.calls[0]![0];
    expect(query).toMatchObject({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: 100, take: 50 });
    expect(query.select).not.toHaveProperty("passwordHash");
    expect(query.select).not.toHaveProperty("tokenHash");
    expect(mockPrisma.shareLink.count).toHaveBeenCalledWith({ where: query.where });
  });

  it("searches the share list for the text typed, not for its LIKE wildcards", async () => {
    // contains does not escape % and _: a search for "100%" matched everything and "a_b" matched "axb".
    mockPrisma.shareLink.findMany.mockResolvedValueOnce([]);
    mockPrisma.shareLink.count.mockResolvedValueOnce(0);

    await listShareLinkPage({ userId: "u1", roles: ["operator"], currentTeamId: "team-1" }, { q: "100%_a" });

    const where = JSON.stringify(mockPrisma.shareLink.findMany.mock.calls[0]![0].where);
    expect(where).toContain('"contains":"100\\\\%\\\\_a"');
    expect(where).not.toContain('"contains":"100%_a"');
  });

  it("normalizes share paths and rejects traversal or unsafe absolute paths", () => {
    expect(normalizeSharePath("/docs//report.pdf")).toBe("docs/report.pdf");
    expect(normalizeSharePath("docs\\nested\\report.pdf")).toBe("docs/nested/report.pdf");
    // Storage trims segments when it resolves a path, so a padded spelling is the same file: it must
    // normalize to the same string the trash and prefix checks see.
    expect(normalizeSharePath("docs/ secret.txt")).toBe("docs/secret.txt");
    expect(normalizeSharePath("docs/ /secret.txt")).toBe("docs/secret.txt");
    expect(normalizeSharePath("docs / sub /x.txt")).toBe("docs/sub/x.txt");
    expect(() => normalizeSharePath("docs/ ../secret.txt")).toThrow(/安全相对路径/);
    expect(() => normalizeSharePath("../secret.txt")).toThrow(/安全相对路径/);
    expect(() => normalizeSharePath("docs/../../secret.txt")).toThrow(/安全相对路径/);
    expect(() => normalizeSharePath("C:\\secret.txt")).toThrow(/安全相对路径/);
    expect(() => normalizeSharePath("//server/share.txt")).toThrow(/安全相对路径/);
    expect(() => normalizeSharePath("docs/\u0000secret.txt")).toThrow(/安全相对路径/);
  });

  it("rejects expired public share tokens", async () => {
    mockPrisma.shareLink.findUnique.mockResolvedValue({ id: "share1", tokenHash: "x", expiresAt: new Date("2020-01-01T00:00:00Z"), revokedAt: null });
    await expect(resolveShareToken("abc")).rejects.toThrow();
  });

  it("rejects a valid token when its indexed target is in the recycle bin", async () => {
    mockPrisma.shareLink.findUnique.mockResolvedValue({
    id: "share-deleted",
    storageNodeId: "node1",
    path: "docs/deleted.txt",
    expiresAt: null,
    revokedAt: null,
    });
    mockPrisma.fileEntry.findFirst.mockResolvedValueOnce({ isDeleted: true });

    await expect(resolveShareToken("abc")).rejects.toThrow();
    expect(mockPrisma.shareLink.update).not.toHaveBeenCalled();
  });

  it("rejects password-protected shares when no password provided", async () => {
    const { hashSharePassword } = await import("../service");
    mockPrisma.shareLink.findUnique.mockResolvedValue({ id: "share1", tokenHash: "x", expiresAt: null, revokedAt: null, maxDownloads: null, accessCount: 0, passwordHash: await hashSharePassword("s3cret") });
    await expect(resolveShareToken("abc")).rejects.toThrow();
  });

  it("rejects password-protected shares with wrong password", async () => {
    const { hashSharePassword } = await import("../service");
    mockPrisma.shareLink.findUnique.mockResolvedValue({ id: "share1", tokenHash: "x", expiresAt: null, revokedAt: null, maxDownloads: null, accessCount: 0, passwordHash: await hashSharePassword("s3cret") });
    await expect(resolveShareToken("abc", "wrong")).rejects.toThrow();
  });

  it("allows password-protected shares with correct password", async () => {
    const { hashSharePassword } = await import("../service");
    mockPrisma.shareLink.findUnique.mockResolvedValue({ id: "share1", tokenHash: "x", expiresAt: null, revokedAt: null, maxDownloads: null, accessCount: 0, passwordHash: await hashSharePassword("s3cret") });
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

  it("checks a download without counting or logging it when asked not to claim (HEAD)", async () => {
    mockPrisma.shareLink.findUnique.mockResolvedValue({ id: "share-head", tokenHash: "x", expiresAt: null, revokedAt: null, maxDownloads: 1, accessCount: 0, passwordHash: null, permissionLevel: "download" });
    const result = await resolveShareToken("abc", undefined, undefined, { claimDownload: false });
    expect(result.id).toBe("share-head");
    expect(mockPrisma.shareLink.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.shareLink.update).not.toHaveBeenCalled();
    expect(mockPrisma.shareAccessLog.create).not.toHaveBeenCalled();
    // A used-up link still says so.
    mockPrisma.shareLink.findUnique.mockResolvedValue({ id: "share-head", tokenHash: "x", expiresAt: null, revokedAt: null, maxDownloads: 1, accessCount: 1, passwordHash: null, permissionLevel: "download" });
    await expect(resolveShareToken("abc", undefined, undefined, { claimDownload: false })).rejects.toThrow();
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
    await expect(resolveShareToken("abc", "legacy-pass")).rejects.toThrow();
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

  it("allows share:manage to revoke team shares without createdBy filter", async () => {
    mockPrisma.shareLink.findFirst.mockResolvedValueOnce({ id: "share_other" });
    mockPrisma.shareLink.update.mockResolvedValueOnce({ id: "share_other", revokedAt: new Date() });
    const session = { userId: "admin1", roles: ["admin"] as const, currentTeamId: "team_a" };
    await revokeShareLink("share_other", "admin1", session as any);
    const where = mockPrisma.shareLink.findFirst.mock.calls[0]![0]!.where;
    expect(where.id).toBe("share_other");
    expect(where.createdBy).toBeUndefined();
  });

  it("redacts path and directory for password-locked peek without password", async () => {
    const { peekShareToken, hashSharePassword } = await import("../service");
    mockPrisma.shareLink.findUnique.mockResolvedValue({
      id: "share-locked",
      tokenHash: "x",
      expiresAt: null,
      revokedAt: null,
      passwordHash: await hashSharePassword("s3cret"),
      permissionLevel: "download",
      entryType: "DIRECTORY",
      name: "Secret folder",
      path: "private/docs",
      storageNodeId: "node1",
      storageNode: { id: "node1", name: "prod-node", driver: "SFTP" },
    });
    mockPrisma.shareAccessLog.create.mockResolvedValue({ id: "log-view" });
    const result = await peekShareToken("abc", { ip: "203.0.113.9" });
    expect(result.hasPassword).toBe(true);
    expect((result as { locked?: boolean }).locked).toBe(true);
    expect(result.path).toBe("");
    expect(result.storageNode?.name).not.toBe("prod-node");
    const wrongTicket = await peekShareToken("abc", { authorizedShareId: "different-share" });
    expect(wrongTicket.locked).toBe(true);
    const validTicket = await peekShareToken("abc", { authorizedShareId: "share-locked" });
    expect(validTicket.locked).toBe(false);
    expect(validTicket.storageNode?.name).toBe("prod-node");
  });

  it("claims maxDownloads atomically via updateMany", async () => {
    mockPrisma.shareLink.findUnique.mockResolvedValue({
      id: "share-quota",
      tokenHash: "x",
      expiresAt: null,
      revokedAt: null,
      maxDownloads: 2,
      accessCount: 0,
      passwordHash: null,
      permissionLevel: "download",
    });
    mockPrisma.shareLink.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.shareAccessLog.create.mockResolvedValue({ id: "log1" });
    const result = await resolveShareToken("abc");
    expect(result.id).toBe("share-quota");
    expect(mockPrisma.shareLink.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "share-quota", accessCount: { lt: 2 } }),
        data: { accessCount: { increment: 1 } },
      }),
    );
  });

  it("releaseShareQuotaClaim decrements accessCount when > 0", async () => {
    mockPrisma.shareLink.updateMany.mockResolvedValue({ count: 1 });
    await releaseShareQuotaClaim("share-quota");
    expect(mockPrisma.shareLink.updateMany).toHaveBeenCalledWith({
      where: { id: "share-quota", accessCount: { gt: 0 } },
      data: { accessCount: { decrement: 1 } },
    });
  });

});

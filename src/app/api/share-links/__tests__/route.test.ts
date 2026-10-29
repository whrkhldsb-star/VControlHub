import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireApiPermissionMock,
  createShareLinkMock,
  createShareLinkFromFileEntryMock,
  listShareLinkPageMock,
  revokeShareLinkMock,
} = vi.hoisted(() => ({
  requireApiPermissionMock: vi.fn(),
  createShareLinkMock: vi.fn(),
  createShareLinkFromFileEntryMock: vi.fn(),
  listShareLinkPageMock: vi.fn(),
  revokeShareLinkMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));
vi.mock("@/lib/share-link/service", () => ({
  createShareLink: createShareLinkMock,
  createShareLinkFromFileEntry: createShareLinkFromFileEntryMock,
  listShareLinkPage: listShareLinkPageMock,
  SHARE_LINK_MAX_PAGE_SIZE: 200,
  SHARE_LINK_STATUS_FILTERS: ["active", "expired", "revoked"],
  revokeShareLink: revokeShareLinkMock,
}));

import { DELETE, GET, POST } from "../route";

const session = {
  userId: "u_1",
  username: "alice",
  roles: ["admin"],
  mustChangePassword: false,
  currentTeamId: "team_1",
};

function postShare(body: unknown) {
  return new Request("https://example.com/api/share-links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/share-links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValue({ session });
    listShareLinkPageMock.mockResolvedValue({ shares: [{ id: "share_1" }], total: 1, page: 1, pageSize: 200 });
    revokeShareLinkMock.mockResolvedValue({
      id: "share_1",
      revokedAt: new Date().toISOString(),
    });
    createShareLinkMock.mockResolvedValue({
      share: { id: "share_1", path: "docs/report.pdf" },
      token: "public-token",
    });
    createShareLinkFromFileEntryMock.mockResolvedValue({
      share: { id: "share_2", path: "uploads/photo.jpg" },
      token: "entry-token",
    });
  });

  it("lists share links with share read permission", async () => {
    const response = await GET(
      new Request("https://example.com/api/share-links"),
    );

    expect(response.status).toBe(200);
    expect(requireApiPermissionMock).toHaveBeenCalledWith("share:read");
    await expect(response.json()).resolves.toMatchObject({
      shares: [{ id: "share_1" }],
      total: 1,
    });
    expect(listShareLinkPageMock).toHaveBeenCalledWith(session, { pageSize: 200 });
  });

  it("passes page, status and search through to the paginated share query", async () => {
    const response = await GET(new Request("https://example.com/api/share-links?page=3&pageSize=50&status=active&q=report"));
    expect(response.status).toBe(200);
    expect(listShareLinkPageMock).toHaveBeenCalledWith(session, { page: 3, pageSize: 50, status: "active", q: "report" });
  });

  it("creates file share links from storage payloads without requiring unrelated legacy resource fields", async () => {
    const response = await POST(
      postShare({
        storageNodeId: "node_1",
        path: "docs/report.pdf",
        entryType: "FILE",
        name: "季度报告.pdf",
        expiresInHours: 24,
      }),
    );

    expect(response.status).toBe(201);
    expect(requireApiPermissionMock).toHaveBeenCalledWith("share:create");
    await expect(response.json()).resolves.toMatchObject({
      token: "public-token",
    });
    expect(createShareLinkMock).toHaveBeenCalledWith({
      session,
      storageNodeId: "node_1",
      path: "docs/report.pdf",
      entryType: "FILE",
      name: "季度报告.pdf",
      expiresInHours: 24,
    });
  });

  it("creates share links from real file-manager entries", async () => {
    const response = await POST(
      postShare({
        fileEntryId: "file_1",
        expiresInHours: 12,
      }),
    );

    expect(response.status).toBe(201);
    expect(requireApiPermissionMock).toHaveBeenCalledWith("share:create");
    await expect(response.json()).resolves.toMatchObject({
      token: "entry-token",
    });
    expect(createShareLinkFromFileEntryMock).toHaveBeenCalledWith({
      session,
      fileEntryId: "file_1",
      expiresInHours: 12,
    });
    expect(createShareLinkMock).not.toHaveBeenCalled();
  });

  it("gives file-manager quick shares a bounded default expiry", async () => {
    const response = await POST(postShare({ fileEntryId: "file_1", quick: true, expiresInHours: 720 }));

    expect(response.status).toBe(201);
    expect(createShareLinkFromFileEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileEntryId: "file_1",
        expiresInHours: 24,
      }),
    );
  });

  it("answers 400, not 500, for numbers and names the database cannot hold", async () => {
    for (const body of [
      { fileEntryId: "file_1", expiresInHours: 1e12 },
      { fileEntryId: "file_1", maxDownloads: 3_000_000_000 },
      { fileEntryId: "file_1", name: "n".repeat(300) },
    ]) {
      expect((await POST(postShare(body))).status).toBe(400);
    }
    expect(createShareLinkFromFileEntryMock).not.toHaveBeenCalled();
    expect(createShareLinkMock).not.toHaveBeenCalled();
  });

  it("rejects password and download limits for metadata-only shares", async () => {
    for (const conflicting of [{ password: "secret" }, { maxDownloads: 2 }]) {
      const response = await POST(
        postShare({
          storageNodeId: "node_1",
          path: "docs/report.pdf",
          permissionLevel: "preview",
          ...conflicting,
        }),
      );
      expect(response.status).toBe(400);
    }
    expect(createShareLinkMock).not.toHaveBeenCalled();
  });

  it("revokes share links with share manage permission", async () => {
    const response = await DELETE(
      new Request("https://example.com/api/share-links?id=share_1", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(200);
    expect(requireApiPermissionMock).toHaveBeenCalledWith("share:manage");
    expect(revokeShareLinkMock).toHaveBeenCalledWith("share_1", "u_1", session);
  });
});

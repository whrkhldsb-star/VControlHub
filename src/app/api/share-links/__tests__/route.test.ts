import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireApiPermissionMock,
  createShareLinkMock,
  listShareLinksMock,
  revokeShareLinkMock,
} = vi.hoisted(() => ({
  requireApiPermissionMock: vi.fn(),
  createShareLinkMock: vi.fn(),
  listShareLinksMock: vi.fn(),
  revokeShareLinkMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));
vi.mock("@/lib/share-link/service", () => ({
  createShareLink: createShareLinkMock,
  listShareLinks: listShareLinksMock,
  revokeShareLink: revokeShareLinkMock,
}));

import { DELETE, GET, POST } from "../route";

const session = {
  userId: "u_1",
  username: "alice",
  roles: ["admin"],
  mustChangePassword: false,
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
    listShareLinksMock.mockResolvedValue([{ id: "share_1" }]);
    revokeShareLinkMock.mockResolvedValue({
      id: "share_1",
      revokedAt: new Date().toISOString(),
    });
    createShareLinkMock.mockResolvedValue({
      share: { id: "share_1", path: "docs/report.pdf" },
      token: "public-token",
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
    });
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

  it("revokes share links with share manage permission", async () => {
    const response = await DELETE(
      new Request("https://example.com/api/share-links?id=share_1", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(200);
    expect(requireApiPermissionMock).toHaveBeenCalledWith("share:manage");
    expect(revokeShareLinkMock).toHaveBeenCalledWith("share_1");
  });
});

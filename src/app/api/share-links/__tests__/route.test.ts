import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSessionMock, sessionHasPermissionMock, createShareLinkMock, listShareLinksMock, revokeShareLinkMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  createShareLinkMock: vi.fn(),
  listShareLinksMock: vi.fn(),
  revokeShareLinkMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({ requireSession: requireSessionMock }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: sessionHasPermissionMock }));
vi.mock("@/lib/share-link/service", () => ({
  createShareLink: createShareLinkMock,
  listShareLinks: listShareLinksMock,
  revokeShareLink: revokeShareLinkMock,
}));
vi.mock("@/lib/http/rate-limit-presets", () => ({
  GENERAL_WRITE_LIMIT: { windowMs: 60_000, max: 60 },
  withRateLimit: vi.fn(() => ({ allowed: true })),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

import { POST } from "../route";

const session = { userId: "u_1", username: "alice", roles: ["admin"], mustChangePassword: false };

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
    requireSessionMock.mockResolvedValue(session);
    sessionHasPermissionMock.mockReturnValue(true);
    createShareLinkMock.mockResolvedValue({
      share: { id: "share_1", path: "docs/report.pdf" },
      token: "public-token",
    });
  });

  it("creates file share links from storage payloads without requiring unrelated legacy resource fields", async () => {
    const response = await POST(postShare({
      storageNodeId: "node_1",
      path: "docs/report.pdf",
      entryType: "FILE",
      name: "季度报告.pdf",
      expiresInHours: 24,
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ token: "public-token" });
    expect(createShareLinkMock).toHaveBeenCalledWith({
      session,
      storageNodeId: "node_1",
      path: "docs/report.pdf",
      entryType: "FILE",
      name: "季度报告.pdf",
      expiresInHours: 24,
    });
  });
});

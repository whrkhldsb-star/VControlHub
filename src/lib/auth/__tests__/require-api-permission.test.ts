import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { requireApiSessionMock, sessionHasPermissionMock } = vi.hoisted(() => ({
  requireApiSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/api-session")>("@/lib/auth/api-session");
  return {
    ...actual,
    requireApiSession: requireApiSessionMock,
    isSessionPayload: actual.isSessionPayload,
  };
});

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: sessionHasPermissionMock,
}));

import { requireApiPermission } from "@/lib/auth/require-api-permission";

const session = {
  userId: "u1",
  username: "admin",
  roles: ["admin"] as const,
  mustChangePassword: false,
  currentTeamId: null,
};

describe("requireApiPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards requireApiSession 401/403 responses without calling permission check", async () => {
    const denied = NextResponse.json({ error: "Password change required", code: "MUST_CHANGE_PASSWORD" }, { status: 403 });
    requireApiSessionMock.mockResolvedValueOnce(denied);
    const result = await requireApiPermission("server:read");
    expect(result).toBe(denied);
    expect(sessionHasPermissionMock).not.toHaveBeenCalled();
  });

  it("returns 403 when session lacks permission", async () => {
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockReturnValueOnce(false);
    const result = await requireApiPermission("user:manage");
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it("returns session when permission is granted", async () => {
    requireApiSessionMock.mockResolvedValueOnce(session);
    sessionHasPermissionMock.mockReturnValueOnce(true);
    const result = await requireApiPermission("server:read");
    expect(result).toEqual({ session });
  });
});

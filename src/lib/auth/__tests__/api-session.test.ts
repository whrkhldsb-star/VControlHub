import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, verifySessionTokenMock, deleteCookieMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  verifySessionTokenMock: vi.fn(),
  deleteCookieMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionCookieName: () => "vch_session",
  verifySessionToken: verifySessionTokenMock,
}));

import { getApiSession, isSessionPayload, requireApiSession } from "@/lib/auth/api-session";
import { NextResponse } from "next/server";

const baseSession = {
  userId: "u1",
  username: "admin",
  roles: ["admin"] as const,
  mustChangePassword: false,
  currentTeamId: null,
};

describe("api-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookiesMock.mockResolvedValue({
      get: () => ({ value: "payload.sig" }),
      delete: deleteCookieMock,
    });
  });

  it("getApiSession returns null when cookie missing", async () => {
    cookiesMock.mockResolvedValueOnce({
      get: () => undefined,
      delete: deleteCookieMock,
    });
    await expect(getApiSession()).resolves.toBeNull();
  });

  it("getApiSession returns verified payload even when mustChangePassword", async () => {
    verifySessionTokenMock.mockResolvedValueOnce({
      ...baseSession,
      mustChangePassword: true,
    });
    const session = await getApiSession();
    expect(session?.mustChangePassword).toBe(true);
  });

  it("requireApiSession returns 401 when unauthenticated", async () => {
    cookiesMock.mockResolvedValueOnce({
      get: () => undefined,
      delete: deleteCookieMock,
    });
    const result = await requireApiSession();
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  it("requireApiSession returns 403 MUST_CHANGE_PASSWORD when password reset required", async () => {
    verifySessionTokenMock.mockResolvedValueOnce({
      ...baseSession,
      mustChangePassword: true,
    });
    const result = await requireApiSession();
    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("MUST_CHANGE_PASSWORD");
    expect(body.redirectTo).toBe("/account/password");
  });

  it("requireApiSession returns session when password is current", async () => {
    verifySessionTokenMock.mockResolvedValueOnce({ ...baseSession });
    const result = await requireApiSession();
    expect(isSessionPayload(result)).toBe(true);
    if (isSessionPayload(result)) {
      expect(result.userId).toBe("u1");
    }
  });
});

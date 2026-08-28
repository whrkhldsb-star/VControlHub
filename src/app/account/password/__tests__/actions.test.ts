/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Session cookies are bound to the password they were minted against, so a
 * password change invalidates every session of that account. That is the point
 * for the *other* sessions, but the user who just typed their own new password
 * must not be bounced to /login by their own action — this action has to mint a
 * replacement cookie against the new credential.
 */

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  changePassword: vi.fn(),
  skipPasswordChange: vi.fn(),
  createSessionToken: vi.fn(),
  getConfiguredSessionTtlSeconds: vi.fn(),
  cookieSet: vi.fn(),
  headerGet: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mocks.cookieSet }),
  headers: async () => ({ get: mocks.headerGet }),
}));
vi.mock("@/lib/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/auth/service", () => ({
  changePassword: mocks.changePassword,
  skipPasswordChange: mocks.skipPasswordChange,
}));
vi.mock("@/lib/auth/session", () => ({
  createSessionToken: mocks.createSessionToken,
  getConfiguredSessionTtlSeconds: mocks.getConfiguredSessionTtlSeconds,
  getSessionCookieName: () => "vch_session",
}));
vi.mock("@/lib/i18n/translations", () => ({
  getServerLocale: async () => "en",
  t: (key: string) => key,
}));
vi.mock("@/lib/config/env", () => ({
  config: { app: { baseUrl: "https://hub.example" } },
}));

const { changePasswordAction } = await import("../actions");

function formData(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.set(key, value);
  return fd;
}

const GOOD_INPUT = {
  currentPassword: "old-pw",
  newPassword: "new-pw",
  confirmPassword: "new-pw",
};

describe("changePasswordAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({
      userId: "u1",
      username: "alice",
      roles: ["operator"],
      mustChangePassword: true,
      currentTeamId: "team_a",
    });
    mocks.changePassword.mockResolvedValue({ success: true });
    mocks.createSessionToken.mockResolvedValue("fresh.token");
    mocks.getConfiguredSessionTtlSeconds.mockResolvedValue(604_800);
    mocks.headerGet.mockReturnValue("https");
  });

  it("reissues this session's cookie so the user is not logged out by their own change", async () => {
    const result = await changePasswordAction(null, formData(GOOD_INPUT));

    expect(result.success).toBeTruthy();
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "vch_session",
      "fresh.token",
      expect.objectContaining({ httpOnly: true, path: "/", maxAge: 604_800 }),
    );
  });

  it("mints the replacement with mustChangePassword cleared", async () => {
    await changePasswordAction(null, formData(GOOD_INPUT));

    // The session that reached this action still says `true`; carrying it over
    // would send a forced-reset user straight back to this page.
    expect(mocks.createSessionToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        username: "alice",
        mustChangePassword: false,
        currentTeamId: "team_a",
      }),
    );
  });

  it("marks the cookie Secure behind an https proxy hop", async () => {
    mocks.headerGet.mockReturnValue("https, http");

    await changePasswordAction(null, formData(GOOD_INPUT));

    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "vch_session",
      "fresh.token",
      expect.objectContaining({ secure: true }),
    );
  });

  it("does not touch the cookie when the change itself failed", async () => {
    mocks.changePassword.mockResolvedValue({ success: false, error: "Current password is incorrect" });

    const result = await changePasswordAction(null, formData(GOOD_INPUT));

    expect(result.error).toBe("Current password is incorrect");
    expect(mocks.createSessionToken).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});

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
  cookieGet: vi.fn(),
  sessionTokenExpiresAt: vi.fn(),
  checkRateLimit: vi.fn(),
  headerGet: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mocks.cookieSet, get: mocks.cookieGet }),
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
  sessionTokenExpiresAt: mocks.sessionTokenExpiresAt,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimitAsync: mocks.checkRateLimit }));
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
    mocks.changePassword.mockResolvedValue({ success: true, credentialBinding: { fingerprint: "new-password-proof", epoch: 2 } });
    mocks.createSessionToken.mockResolvedValue("fresh.token");
    mocks.getConfiguredSessionTtlSeconds.mockResolvedValue(604_800);
    mocks.cookieGet.mockReturnValue({ value: "old.cookie" });
    mocks.sessionTokenExpiresAt.mockReturnValue(null);
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, retryAfterMs: 0 });
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
      { credentialBinding: { fingerprint: "new-password-proof", epoch: 2 }, expiresAt: null },
    );
  });

  it("keeps a remember-me session's original expiry instead of cutting it to the default lifetime", async () => {
    const thirtyDaysAhead = Date.now() + 29 * 86_400_000;
    mocks.sessionTokenExpiresAt.mockReturnValue(thirtyDaysAhead);
    mocks.getConfiguredSessionTtlSeconds.mockImplementation(async (remember?: boolean) => (remember ? 2_592_000 : 604_800));

    await changePasswordAction(null, formData(GOOD_INPUT));

    expect(mocks.createSessionToken).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ expiresAt: thirtyDaysAhead }));
    const maxAge = mocks.cookieSet.mock.calls[0]![2].maxAge as number;
    expect(maxAge).toBeGreaterThan(28 * 86_400);
    expect(maxAge).toBeLessThanOrEqual(29 * 86_400);
  });

  it("tells the user what is wrong with the new password instead of showing validator JSON", async () => {
    const { ZodError } = await import("zod");
    mocks.changePassword.mockRejectedValueOnce(new ZodError([{ code: "custom", path: ["confirmPassword"], message: "Passwords do not match" }]));
    const mismatch = await changePasswordAction(null, formData(GOOD_INPUT));
    expect(mismatch.error).toBe("accountPasswordPage.action.mismatch");

    mocks.changePassword.mockRejectedValueOnce(new ZodError([{ code: "too_small", minimum: 8, origin: "string", inclusive: true, path: ["newPassword"], message: "Too short" }]));
    const tooShort = await changePasswordAction(null, formData(GOOD_INPUT));
    expect(tooShort.error).toBe("accountPasswordPage.action.invalidInput");
  });

  it("limits how often the current password can be tried from one session", async () => {
    mocks.checkRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterMs: 60_000 });

    const result = await changePasswordAction(null, formData(GOOD_INPUT));

    expect(result.error).toBe("accountPasswordPage.action.tooManyAttempts");
    expect(mocks.changePassword).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("password-change:u1", expect.objectContaining({ maxRequests: 5 }));
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

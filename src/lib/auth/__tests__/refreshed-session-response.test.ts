// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: vi.fn(async () => ({ sessionEpoch: 0, passwordHash: "$2b$10$fixture", twoFactorSecret: null })) } } }));
// A 30-day "remember me" lifetime, as the security settings resolve it.
vi.mock("@/lib/runtime-settings/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/runtime-settings/service")>()),
  getRuntimeSettingNumber: async (key: string) => (key === "security.rememberSessionTtlSeconds" ? 30 * 24 * 3600 : 7 * 24 * 3600),
}));

import { createSessionToken, getSessionCookieName } from "@/lib/auth/session";
import { refreshedSessionResponse } from "@/lib/auth/refreshed-session-response";

/** The signed envelope's expiry, read the way the browser's cookie carries it. */
const expiryOf = (token: string) => (JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8")) as { exp: number }).exp;

const session = { userId: "u_1", username: "admin", roles: ["admin" as const], mustChangePassword: false, currentTeamId: null };

describe("re-minting the session after a 2FA change", () => {
  it("keeps a remember-me sign-in's lifetime instead of cutting it to the default", async () => {
    // Enabling or disabling 2FA re-minted the cookie with the default lifetime:
    // a 30-day "remember me" session ended a few days later.
    const remembered = await createSessionToken(session, { remember: true });
    const expiresAt = expiryOf(remembered);
    expect(expiresAt - Date.now()).toBeGreaterThan(29 * 24 * 3600 * 1000);
    const request = new Request("https://hub.test/api/auth/2fa/enable", { headers: { cookie: `${getSessionCookieName()}=${encodeURIComponent(remembered)}` } });

    const response = await refreshedSessionResponse(session, request, { success: true }, undefined as never);

    const cookie = response.cookies.get(getSessionCookieName())!;
    expect(expiryOf(cookie.value)).toBe(expiresAt);
    expect(cookie.maxAge).toBeGreaterThan(29 * 24 * 3600);
  });

  it("gives a session without a readable cookie the default lifetime", async () => {
    const response = await refreshedSessionResponse(session, new Request("https://hub.test/api/auth/2fa/enable"), { success: true }, undefined as never);
    const cookie = response.cookies.get(getSessionCookieName())!;
    expect(cookie.maxAge).toBeLessThan(29 * 24 * 3600);
  });

  it("never reads an expiry from a cookie that has already expired", async () => {
    const { sessionTokenExpiresAt } = await import("@/lib/auth/session");
    const stale = `${Buffer.from(JSON.stringify({ exp: Date.now() - 1_000 })).toString("base64url")}.sig`;
    expect(sessionTokenExpiresAt(stale)).toBeNull();
    expect(sessionTokenExpiresAt("not-a-token")).toBeNull();
  });
});

// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique: vi.fn(async () => ({ id: "u_1", username: "admin", roles: [], status: "ACTIVE", mustChangePassword: false, sessionEpoch: 0, passwordHash: "$2b$10$fixture", twoFactorSecret: null })) }, revokedSession: { findUnique: vi.fn(async () => null) } } }));
// A 30-day "remember me" lifetime, as the security settings resolve it.
vi.mock("@/lib/runtime-settings/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/runtime-settings/service")>()),
  getRuntimeSettingNumber: async (key: string) => (key === "security.rememberSessionTtlSeconds" ? 30 * 24 * 3600 : 7 * 24 * 3600),
}));

import { verifySessionToken, createSessionToken, getSessionCookieName, captureSessionCredentialBinding } from "@/lib/auth/session";
import { refreshedSessionResponse } from "@/lib/auth/refreshed-session-response";

/** The signed envelope's expiry, read the way the browser's cookie carries it. */
const expiryOf = (token: string) => (JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8")) as { exp: number }).exp;

const session = { userId: "u_1", username: "admin", roles: ["admin" as const], mustChangePassword: false, currentTeamId: null };

const binding = captureSessionCredentialBinding({ passwordHash: "$2b$10$fixture", sessionEpoch: 0 });

describe("re-minting the session after a 2FA change", () => {
  it("keeps a remember-me sign-in's lifetime instead of cutting it to the default", async () => {
    // Enabling or disabling 2FA re-minted the cookie with the default lifetime:
    // a 30-day "remember me" session ended a few days later.
    const remembered = await createSessionToken(session, { remember: true });
    const expiresAt = expiryOf(remembered);
    expect(expiresAt - Date.now()).toBeGreaterThan(29 * 24 * 3600 * 1000);
    const request = new Request("https://hub.test/api/auth/2fa/enable", { headers: { cookie: `${getSessionCookieName()}=different; ${getSessionCookieName()}=${encodeURIComponent(remembered)}` } });

    const response = await refreshedSessionResponse(await verifySessionToken(remembered), request, { success: true }, binding);

    const cookie = response.cookies.get(getSessionCookieName())!;
    expect(expiryOf(cookie.value)).toBe(expiresAt);
    expect(Number(cookie.expires)).toBe(expiresAt);
  });

  it("uses the expiry of the authenticated cookie when another valid cookie of the same name precedes it", async () => {
    const long = await createSessionToken(session, { remember: true });
    const short = await createSessionToken(session, { expiresAt: Date.now() + 60_000 });
    const name = getSessionCookieName();
    const request = new Request("https://hub.test", { headers: { cookie: `${name}=${long}; ${name}=${short}` } });
    const response = await refreshedSessionResponse(await verifySessionToken(short), request, { success: true }, binding);
    expect(expiryOf(response.cookies.get(name)!.value)).toBe(expiryOf(short));
  });

  it("returns committed recovery codes and requests a fresh sign-in when the session expires", async () => {
    vi.useFakeTimers();
    try {
      const token = await createSessionToken(session, { expiresAt: Date.now() + 500 });
      const verified = await verifySessionToken(token);
      vi.advanceTimersByTime(501);
      const response = await refreshedSessionResponse(verified, new Request("https://hub.test"), { recoveryCodes: ["once"] }, binding);
      expect(await response.json()).toEqual({ recoveryCodes: ["once"], requiresLogin: true });
      expect(response.cookies.get(getSessionCookieName())?.maxAge).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it("keeps a signed past deadline and ignores unsigned expiry claims", async () => {
    const { sessionTokenExpiresAt } = await import("@/lib/auth/session");
    const past = Date.now() - 1_000;
    expect(sessionTokenExpiresAt(await createSessionToken(session, { expiresAt: past }))).toBe(past);
    const stale = `${Buffer.from(JSON.stringify({ exp: Date.now() - 1_000 })).toString("base64url")}.sig`;
    expect(sessionTokenExpiresAt(stale)).toBeNull();
    expect(sessionTokenExpiresAt("not-a-token")).toBeNull();
  });
});
